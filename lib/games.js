/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
"use strict";

var backupFile = require('./backup-file');
var debug      = require('debug')('games');
var events     = require('events');
var fs         = require('fs');
var path       = require('path');
var gameInfo   = require('./gameinfo');
var hftConfig  = require('./config');
var _          = require('underscore');

var InstalledGamesList = function() {
  var installedGamesPath;
  var installedGamesList;
  var eventEmitter = new events.EventEmitter();
  var watcher;

  var close = function() {
    if (watcher) {
      watcher.close();
      watcher = undefined;
    }
  };

  var onFolderChanged = function(event, filename) {
    debug("something changed: " + filename);
    if (!filename || filename === path.basename(installedGamesPath)) {
      // This is very hacky. Basically I have no idea when the notification will come through
      // When the file is just starting to be written to? After it's changed and closed?
      // So, I wait 1/2 a second. Ideally I'd probably lock the file, check when it's unlocked.
      // But locks for files suck as they can get out of sync if there's a bug. So, for now
      // let's hope this is enough.
      setTimeout(function() {
        eventEmitter.emit('changed');
      }, 500);
    }
  };

  var reset = function() {
    close();
    var config = hftConfig.getConfig();
    installedGamesPath = config ? config.installedGamesListPath : undefined;
    installedGamesList = [];
    var dirPath = path.dirname(installedGamesPath);
    watcher = fs.watch(dirPath, onFolderChanged);
  };
  reset();

  var indexByPath = function(gamePath) {
    for (var ii = 0; ii < installedGamesList.length; ++ii) {
      if (installedGamesList[ii].path === gamePath) {
        return ii;
      }
    }
    return -1;
  };

  var getInstalledGames = function() {
    if (!installedGamesPath) {
      return [];
    }
    var content = fs.readFileSync(installedGamesPath, {encoding: "utf-8"});
    installedGamesList = JSON.parse(content);
    return installedGamesList;
  };

  var putInstalledGames = function() {
    backupFile.backup(installedGamesPath);
    fs.writeFileSync(installedGamesPath, JSON.stringify(installedGamesList, undefined, "  "));
  };

  /**
   * Makes the config and games db if they do not exit
   */
  var init = function() {
    hftConfig.init();
    reset();
    if (!fs.existsSync(installedGamesPath)) {
      putInstalledGames();
      console.log("Wrote game db");
    }
  };

  /**
   * Adds a locally installed game to the list of games locally
   * installed :p
   *
   * @param {string} gamePath path to game
   * @param {string[]?} opt_fileList list file files relative to
   *        gamePath that were installed.
   */
  var add = function(gamePath, opt_fileList) {
    var fullGamePath = path.resolve(gamePath);

    try {
      var info = gameInfo.readGameInfo(fullGamePath);
      if (!info) {
        throw "";
      }
      gameInfo.checkRequiredFiles(info, info.rootPath);

      getInstalledGames();
      var index = indexByPath(gamePath);
      var added = false;
      if (index < 0) {
        index = 0;
        installedGamesList.unshift({path: gamePath});
        added = true;
      } else {
        console.log(gamePath + " already installed : overwriting");
      }
      if (opt_fileList) {
        var game = installedGamesList[index];
        game.files = _.union(opt_fileList, game.files || []);
      }
      // Need to notify GameDB to add game
      putInstalledGames();
      if (added) {
        console.log("added: " + gamePath);
        eventEmitter.emit('changed');
      }
      return true;
    } catch (e) {
      console.error(gamePath + " does not appear to be a happyFunTimes game");
      console.error(e);
      return false;
    }
  };

  /**
   * Remove a game from the list of locally installed games.
   * @param {string} gamePathOrId path to game or gameId
   */
  var remove = function(gamePathOrId, options) {
    options = options || {};
    try {
      getInstalledGames();
      if (options.bad) {
        installedGamesList = installedGamesList.filter(function(info) {
          var filePath = info.path;
          var keep = false;
          try {
            gameInfo.readGameInfo(filePath);
            keep = true;
          } catch (e) {
            console.log("removing: " + info.path);
          }
          return keep;
        });
      } else {
        var gamePath;
        var runtimeInfo = require('../lib/gamedb').getGameById(gamePathOrId);
        if (runtimeInfo) {
          gamePath = runtimeInfo.rootPath;
        } else {
          gamePath = path.resolve(gamePathOrId);
        }

        var index = indexByPath(gamePath);
        if (index < 0) {
          console.warn(gamePathOrId + " not installed");
          return false;
        }
        installedGamesList.splice(index, 1);
        console.log("removed: " + gamePath);
      }
      if (!options.dryRun) {
        putInstalledGames();
      }
      eventEmitter.emit('changed');
    } catch (e) {
      console.error("error: removing game: " + gamePath);
      console.error(e);
      return false;
    }
  };

  /**
   * Gets all the installed games
   * with absolute paths
   */
  var get = function() {
    getInstalledGames();
    return installedGamesList.map(function(game) {
      var newGame = JSON.parse(JSON.stringify(game));
      newGame.path = path.resolve(path.dirname(installedGamesPath), newGame.path);
      return newGame;
    });
  };

  this.add    = add.bind(this);
  this.get    = get.bind(this);
  this.init   = init.bind(this);
  this.remove = remove.bind(this);
  this.reset  = reset.bind(this);
  this.close  = close.bind(this);

  // expose the event emitter.
  this.on = eventEmitter.on.bind(eventEmitter);
  this.removeListener = eventEmitter.removeListener.bind(eventEmitter);
  this.addListener = this.on;
};

module.exports = new InstalledGamesList();

