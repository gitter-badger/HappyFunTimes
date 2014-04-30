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

define([
    '../../scripts/tdl/buffers',
    '../../scripts/tdl/fast',
    '../../scripts/tdl/math',
    '../../scripts/tdl/models',
    '../../scripts/tdl/primitives',
    '../../scripts/tdl/programs',
    '../../scripts/gamebutton',
    '../../scripts/imageprocess',
    '../../scripts/input',
    '../../scripts/misc',
    './bomb',
  ], function(
    Buffers,
    Fast,
    math,
    Models,
    Primitives,
    Programs,
    GameButton,
    ImageProcess,
    Input,
    Misc,
    Bomb) {

  var m4 = Fast.matrix4;

  var availableColors = [];
  var nameFontOptions = {
    yOffset: 8,
    height: 10,
    fillStyle: "black",
  };


  var s_playerVertexShader = [
    "attribute vec4 position;                  ",
    "attribute vec2 texcoord;                  ",
    "                                          ",
    "uniform mat4 u_matrix;                    ",
    "                                          ",
    "varying vec2 v_texcoord;                  ",
    "                                          ",
    "void main() {                             ",
    "  gl_Position = u_matrix * position;      ",
    "  v_texcoord = texcoord;                  ",
    "}                                         ",
  ].join("\n");

  var s_playerFragmentShader = [
    "precision mediump float;                                                          ",
    "                                                                                  ",
    "uniform sampler2D u_texture;                                                      ",
    "uniform vec2 u_adjustRange;                                                       ",
    "uniform vec4 u_hsvaAdjust;                                                        ",
    "                                                                                  ",
    "varying vec2 v_texcoord;                                                          ",
    "                                                                                  ",
    "vec3 rgb2hsv(vec3 c) {                                                            ",
    "  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);                                ",
    "  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));               ",
    "  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));               ",
    "                                                                                  ",
    "  float d = q.x - min(q.w, q.y);                                                  ",
    "  float e = 1.0e-10;                                                              ",
    "  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);        ",
    "}                                                                                 ",
    "                                                                                  ",
    "vec3 hsv2rgb(vec3 c) {                                                            ",
    "  c = vec3(c.x, clamp(c.yz, 0.0, 1.0));                                           ",
    "  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);                                  ",
    "  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);                               ",
    "  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);                       ",
    "}                                                                                 ",
    "                                                                                  ",
    "void main() {                                                                     ",
    "  vec4 color = texture2D(u_texture, v_texcoord);                                  ",
    "  if (color.a < 0.1) {                                                            ",
    "    discard;                                                                      ",
    "  }                                                                               ",
    "  vec3 hsv = rgb2hsv(color.rgb);                                                  ",
    "  float affectMult = step(u_adjustRange.x, hsv.r) * step(hsv.r, u_adjustRange.y); ",
    "  vec3 rgb = hsv2rgb(hsv + u_hsvaAdjust.xyz * affectMult);                        ",
    "  gl_FragColor = vec4(rgb, color.a + u_hsvaAdjust.a);                             ",
    "}                                                                                 ",
  ].join("\n");

  var s_playerModel;

  var makePlayerModel = function() {
    if (s_playerModel) {
      return;
    }

    var arrays = {
      position: new Primitives.AttribBuffer(2, [
          0,  0,
          1,  0,
          0,  1,
          1,  1,
      ]),
      texcoord: new Primitives.AttribBuffer(2, [
          0,  0,
          1,  0,
          0,  1,
          1,  1,
      ]),
      indices: new Primitives.AttribBuffer(3, [
          0, 1, 2,
          2, 1, 3,
      ], 'Uint16Array')
    }
    var textures = {
    };
    var program = new Programs.Program(
        s_playerVertexShader, s_playerFragmentShader);
    s_playerModel = new Models.Model(program, arrays, textures);
  };

  //    2     -1 = not pressed
  //  3 | 1
  //   \|/
  // 4--+--0
  //   /|\
  //  5 | 7
  //    6
  var walkAnim = ['avatarWalkR0', 'avatarWalkR1', 'avatarWalkR2', 'avatarWalkR1'];
  var directionInfo = [
    { /* 0 right */
      dx:  1,
      dy:  0,
      hflip: false,
      anims: {
        idle: 'avatarStandR',
        walk: walkAnim,
      },
      noChangeDirs: [],
    },
    { /* 1 right up*/
      dx:  1,
      dy: -1,
      hflip: false,
      anims: {
        idle: 'avatarStandR',
        walk: walkAnim,
      },
      noChangeDirs: [0, 2],
    },
    { /* 2 up */
      dx:  0,
      dy: -1,
      hflip: false,
      anims: {
        idle: 'avatarStandU',
        walk: ['avatarWalkU0', 'avatarWalkU1'],
      },
      noChangeDirs: [],
    },
    { /* 3 left up */
      dx: -1,
      dy: -1,
      hflip: true,
      anims: {
        idle: 'avatarStandR',
        walk: walkAnim,
      },
      noChangeDirs: [2, 4],
    },
    { /* 4 left */
      dx: -1,
      dy:  0,
      hflip: true,
      anims: {
        idle: 'avatarStandR',
        walk: walkAnim,
      },
      noChangeDirs: [],
    },
    { /* 5 left down */
      dx: -1,
      dy:  1,
      hflip: true,
      anims: {
        idle: 'avatarStandR',
        walk: walkAnim,
      },
      noChangeDirs: [4, 6],
    },
    { /* 6 down */
      dx:  0,
      dy:  1,
      hflip: false,
      anims: {
        idle: 'avatarStandD',
        walk: ['avatarWalkD0', 'avatarWalkD1'],
      },
      noChangeDirs: [],
    },
    { /* 7 right down */
      dx:  1,
      dy:  1,
      hflip: false,
      anims: {
        idle: 'avatarStandR',
        walk: walkAnim,
      },
      noChangeDirs: [0, 6],
    },
  ];

  var freeBombs = [];
  var getBomb = function(services) {
    if (freeBombs.length) {
      return freeBombs.pop();
    }
    return new Bomb(services);
  };

  var putBomb = function(bomb) {
    bomb.reset();
    freeBombs.push(bomb);
  };

  /**
   * Player represents a player in the game.
   * @constructor
   */
  var Player = (function() {
    return function(services, position, name, netPlayer) {
      this.services = services;
      this.renderer = services.renderer;
      this.roundsPlayed = 0;
      this.wins = 0;

      // add the button before the player so it will get
      // processed first.
      this.abutton = new GameButton(services.entitySystem);

      services.entitySystem.addEntity(this);
      services.drawSystem.addEntity(this);
      this.netPlayer = netPlayer;
      this.position = position;

      if (availableColors.length == 0) {
        var avatar = this.services.images.avatar;
        for (var ii = 0; ii < 64; ++ii) {
          availableColors.push({
            hsv: [ii % 16 / 16, 0, 0, 0],
            set: ii / 16 | 0,
          });
        }
      }

      this.color = availableColors[Math.floor(Math.random() * availableColors.length)];
      availableColors.splice(this.color, 1);
      this.sendCmd('setColor', this.color);
      this.setName(name);

      this.imageSet = this.services.images.avatar[this.color.set];

      makePlayerModel();

      var images = this.services.images;
      this.matrix = new Float32Array(16);
      m4.identity(this.matrix);

      this.textures = {
        u_texture: this.imageSet.avatarStandU,
      };

      netPlayer.addEventListener('disconnect', Player.prototype.handleDisconnect.bind(this));
      netPlayer.addEventListener('pad', Player.prototype.handlePadMsg.bind(this));
      netPlayer.addEventListener('abutton', Player.prototype.handleAButtonMsg.bind(this));
      netPlayer.addEventListener('setName', Player.prototype.handleNameMsg.bind(this));
      netPlayer.addEventListener('busy', Player.prototype.handleBusyMsg.bind(this));

      this.setState('waiting');
    };
  }());

  Player.prototype.reset = function(x, y) {
    var globals = this.services.globals;
    while (this.bombs && this.bombs.length) {
      putBomb(this.bombs.pop());
    }
    this.setPosition(x, y);
    this.uniforms = {
      u_matrix: this.matrix,
      u_adjustRange: [0, 1],
      u_hsvaAdjust: this.color.hsv.slice(),
    };
    this.playing = true;
    this.alive = true;
    this.display = true;
    this.scale = 1;
    this.rotation = 0;
    this.animTimer = 0;
    this.bombs = [];
    for (var ii = 0; ii < globals.numStartingBombs; ++ii) {
      this.bombs.push(getBomb(this.services));
    }
    this.bombSize = globals.bombStartSize;
    this.haveKick = false;
    this.setFacing(6);
    this.direction = -1;  // direction player is pressing.
    this.setState('start');

//if (!window.bombs) {
//  window.bombs = true;
//  setTimeout(function() { this.tryPlaceBomb( 1, 1); }.bind(this),  250);
//  setTimeout(function() { this.tryPlaceBomb( 3, 1); }.bind(this),  500);
//  setTimeout(function() { this.tryPlaceBomb( 5, 1); }.bind(this),  750);
//  setTimeout(function() { this.tryPlaceBomb(15, 1); }.bind(this), 1000);
//  setTimeout(function() { this.tryPlaceBomb( 3, 3); }.bind(this), 1250);
//}

  };

  Player.prototype.reportDied = function() {
    if (this.alive) {
      this.alive = false;
      this.services.playerManager.playerDied();
    }
  };

  Player.prototype.setBombSize = function(size) {
    var levelManager = this.services.levelManager;
    var maxSize = Math.max(levelManager.tilesAcross, levelManager.tilesDown);
    this.bombSize = Math.min(maxSize, size);
  };

  Player.prototype.returnBomb = function(bomb) {
    this.bombs.push(bomb);
  };

  Player.prototype.setAnimFrame = function(name) {
    this.textures.u_texture = this.imageSet[name];
  };

  Player.prototype.setFacing = function(direction) {
    var oldFacing = this.facing;
    this.facing = direction;
    this.facingInfo = directionInfo[direction];
    this.hflip = this.facingInfo.hflip;
    if (this.facingInfo.noChangeDirs.indexOf(oldFacing) < 0) {
      this.anims = this.facingInfo.anims;
    }
  };

  Player.prototype.setPosition = function(x, y) {
    this.position[0] = x;
    this.position[1] = y;
  };

  Player.prototype.setName = function(name) {
    if (name != this.playerName) {
      this.playerName = name;
      this.nameImage = ImageProcess.makeTextImage(name, nameFontOptions);
    }
  };

  Player.prototype.setState = function(state) {
    this.state = state;
    var init = this["init_" + state];
    if (init) {
      init.call(this);
    }
    this.process = this["state_" + state];
  };

  Player.prototype.removeFromGame = function() {
    this.reportDied();
    this.services.entitySystem.removeEntity(this);
    this.services.drawSystem.removeEntity(this);
    this.services.playerManager.removePlayer(this);
    this.abutton.destroy();
    availableColors.push(this.color);
  };

  Player.prototype.handleDisconnect = function() {
    this.removeFromGame();
  };

  Player.prototype.handleBusyMsg = function(msg) {
    // We ignore this message
  };

  Player.prototype.handlePadMsg = function(msg) {
    this.direction = msg.dir;
    if (this.direction >= 0) {
      this.setFacing(this.direction);
    }
  };

  Player.prototype.handleAButtonMsg = function(msg) {
    this.abutton.setState(msg.abutton);
  };

  Player.prototype.handleNameMsg = function(msg) {
    if (!msg.name) {
      this.sendCmd('setName', {
        name: this.playerName
      });
    } else {
     this.setName(msg.name.replace(/[<>]/g, ''));
    }
  };

  Player.prototype.checkBombPlace = function() {
    if (!this.abutton.justOn()) {
      return;
    }
    var tileWidth = 16;
    var tileHeight = 16;
    var tx = (this.position[0] + tileWidth  * 0.5 * this.facingInfo.dx) / tileWidth  | 0;
    var ty = (this.position[1] + tileHeight * 0.5 * this.facingInfo.dy) / tileHeight | 0;
    if (!this.tryPlaceBomb(tx, ty)) {
      tx = this.position[0] / tileWidth  | 0;
      ty = this.position[1] / tileHeight | 0;
      this.tryPlaceBomb(tx, ty);
    }
  };

  Player.prototype.tryPlaceBomb = function(tx, ty) {
    if (!this.bombs.length) {
      return;
    }
    var levelManager = this.services.levelManager;
    var tile = levelManager.layer1.getTile(tx, ty);
    var tileInfo = levelManager.getTileInfo(tile);

    if (!tileInfo.info.bombOk) {
      return;
    }

    var bomb = this.bombs.pop();
    bomb.place(this, tx, ty, this.bombSize);
    return true;
  };

  Player.prototype.restoreBomb = function(bomb) {
    this.bombs.push(bomb);
  };

  Player.prototype.sendCmd = function(cmd, data) {
    this.netPlayer.sendCmd(cmd, data);
  };

  Player.prototype.checkForDeath = function() {
    // Need to check if we're standing on death.
    // Could be 1 of 2 tiles (or is it 4?). I think
    // as long as there are no open areas it's 2.

    // For now let's just check the center and see
    // how it feels.
    var tileWidth = 16;
    var tileHeight = 16;
    var tx = (this.position[0]) / tileWidth  | 0;
    var ty = (this.position[1]) / tileHeight | 0;
    var levelManager = this.services.levelManager;
    var tile = levelManager.layer1.getTile(tx, ty);
    var tileInfo = levelManager.getTileInfo(tile);
    if (tileInfo.info.flame) {
      this.setState('die');
      return true;
    }

    // Lets check for powerups here too?
    var crateType = tileInfo.info.crateType;
    if (crateType) {
      levelManager.layer1.setTile(tx, ty, levelManager.tiles.empty.id);
      switch (crateType) {
      case 'gold':
        this.setBombSize(10000);
        break;
      case 'kick':
        this.haveKick = true;
        break;
      case 'bomb':
        this.bombs.push(getBomb(this.services));
        break;
      case 'flame':
        this.setBombSize(this.bombSize + 1);
        break;
      }
    }


  };

  // This state is when the round has finished.
  // Show the character but don't update anything.
  Player.prototype.init_end = function() {
    this.alive = false;
  };

  Player.prototype.state_end = function() {
  };

  // This state is when you're waiting to join a game.
  // Don't show any characters.
  Player.prototype.init_waiting = function() {
    this.display = false;
    this.alive = false;
    this.sendCmd('waitForNextGame'); //??
  };

  Player.prototype.state_waiting = function() {
  };

  // This state is just before the game has started
  Player.prototype.init_start = function() {
    // player.reset will have just been called.
  };

  Player.prototype.state_start = function() {
  };

  Player.prototype.init_idle = function() {
  };

  Player.prototype.state_idle = function() {
    this.setAnimFrame(this.anims.idle);
    if (this.checkForDeath()) {
      return;
    }
    this.checkBombPlace();
    if (this.direction >= 0) {
      this.setState('walk');
    }
  };

  Player.prototype.init_walk = function() {
    this.animTimer = 0;
  };

  Player.prototype.state_walk = function() {
    var globals = this.services.globals;
    var levelManager = this.services.levelManager;
    this.animTimer += globals.walkAnimSpeed;
    this.setAnimFrame(this.anims.walk[(this.animTimer | 0) % this.anims.walk.length]);

    if (this.direction < 0) {
      this.setState('idle');
      return;
    }

    // we're either in a column, row, or at an intersection
    var tileWidth  = 16;
    var tileHeight = 16;

    var dx = this.facingInfo.dx;
    var dy = this.facingInfo.dy;
    var newX = this.position[0] + dx * globals.walkSpeed * globals.elapsedTime;
    var newY = this.position[1] + dy * globals.walkSpeed * globals.elapsedTime;

    if (dx > 0) {
      for (var ii = 0; ii < 2; ++ii) {
        var tileX = newX + tileWidth / 2;
        var tileY = this.position[1] - tileHeight / 2 + ii * (tileHeight - 1);
        var tile = levelManager.layer1.getTileByPixels(tileX, tileY);
        var tileInfo = levelManager.getTileInfo(tile);
        if (tileInfo.info.solid) {
          newX -= tileX % tileWidth;
        }
      }
    } else if (dx < 0) {
      for (var ii = 0; ii < 2; ++ii) {
        var tileX = newX - tileWidth / 2;
        var tileY = this.position[1] - tileHeight / 2 + ii * (tileHeight - 1);
        var tile = levelManager.layer1.getTileByPixels(tileX, tileY);
        var tileInfo = levelManager.getTileInfo(tile);
        if (tileInfo.info.solid) {
          newX += tileWidth - tileX % tileWidth;
        }
      }
    }

    if (dy > 0) {
      for (var ii = 0; ii < 2; ++ii) {
        var tileX = this.position[0] - tileWidth / 2 + ii * (tileWidth - 1);
        var tileY = newY + tileWidth / 2;
        var tile = levelManager.layer1.getTileByPixels(tileX, tileY);
        var tileInfo = levelManager.getTileInfo(tile);
        if (tileInfo.info.solid) {
          newY -= tileY % tileHeight;
        }
      }
    } else if (dy < 0) {
      for (var ii = 0; ii < 2; ++ii) {
        var tileX = this.position[0] - tileWidth / 2 + ii * (tileWidth - 1);
        var tileY = newY - tileWidth / 2;
        var tile = levelManager.layer1.getTileByPixels(tileX, tileY);
        var tileInfo = levelManager.getTileInfo(tile);
        if (tileInfo.info.solid) {
          newY += tileHeight - tileY % tileHeight;
        }
      }
    }


    this.position[0] = newX;
    this.position[1] = newY;

    if (this.checkForDeath()) {
      return;
    }

    this.checkBombPlace();
  };

  Player.prototype.init_die = function() {
    this.sendCmd('died');
    this.reportDied();
    this.dieTimer = 0;
  };
  Player.prototype.state_die = function() {
    var globals = this.services.globals;
    this.uniforms.u_hsvaAdjust[0] += globals.dieColorSpeed * globals.elapsedTime;
    this.uniforms.u_hsvaAdjust[2] = (globals.frameCount & 2) ? 1 : 0;
    this.rotation += globals.dieRotationSpeed * globals.elapsedTime;
    this.dieTimer += globals.elapsedTime;
    if (this.dieTimer >= globals.dieDuration) {
      this.setState('evaporate');
    }
  };

  Player.prototype.init_evaporate = function() {
    this.dieTimer = 0;
  };

  Player.prototype.state_evaporate = function() {
    var globals = this.services.globals;
    this.uniforms.u_hsvaAdjust[0] += globals.dieColorSpeed * globals.elapsedTime;
    this.uniforms.u_hsvaAdjust[2] = (globals.frameCount & 2) ? 1 : 0;
    this.rotation += globals.dieRotationSpeed * globals.elapsedTime;
    this.scale += globals.dieScaleSpeed * globals.elapsedTime;
    this.dieTimer += globals.elapsedTime;
    var a = this.dieTimer / globals.evaporateDuration;
    this.uniforms.u_hsvaAdjust[3] = -a;
    if (this.dieTimer >= globals.evaporateDuration) {
      this.setState('dead');
    }
  };

  Player.prototype.init_dead = function() {
    this.display = false;
  };

  Player.prototype.state_dead = function() {
  };

  Player.prototype.draw = function(renderer) {
    if (!this.display) {
      return;
    }
    var globals = this.services.globals;
    var images = this.services.images;
    var off = {};
    this.services.levelManager.getDrawOffset(off);

    var scale  = globals.scale * this.scale;
    var width  = 16 * scale;
    var height = 16 * scale;

    m4.identity(this.matrix);
    m4.scale(this.matrix, [2 / renderer.canvas.width, -2 / renderer.canvas.height, 1]);
    m4.translate(this.matrix, [
                 -renderer.canvas.width  * 0.5 + off.x + this.position[0] * globals.scale,
                 -renderer.canvas.height * 0.5 + off.y + this.position[1] * globals.scale,
                 0]);
    m4.rotateZ(this.matrix, this.rotation);
    m4.scale(this.matrix, [width * (this.hflip ? -1 : 1), height, 1]);
    m4.translate(this.matrix, [-0.5, -0.5, 0]);

    s_playerModel.drawPrep();
    s_playerModel.draw(this.uniforms, this.textures);
  };

  return Player;
});

