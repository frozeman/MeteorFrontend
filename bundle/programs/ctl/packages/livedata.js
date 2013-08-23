(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var check = Package.check.check;
var Match = Package.check.Match;
var Random = Package.random.Random;
var EJSON = Package.ejson.EJSON;
var _ = Package.underscore._;
var Deps = Package.deps.Deps;
var Log = Package.logging.Log;
var LocalCollection = Package.minimongo.LocalCollection;

/* Package-scope variables */
var DDP, DDPServer, LivedataTest, toSockjsUrl, toWebsocketUrl, StreamServer, Server, SUPPORTED_DDP_VERSIONS, MethodInvocation, parseDDP, stringifyDDP, allConnections;

(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/common.js                                                                              //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
LivedataTest = {};                                                                                          // 1
                                                                                                            // 2
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/stream_client_nodejs.js                                                                //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
// @param endpoint {String} URL to Meteor app                                                               // 1
//   "http://subdomain.meteor.com/" or "/" or                                                               // 2
//   "ddp+sockjs://foo-**.meteor.com/sockjs"                                                                // 3
//                                                                                                          // 4
// We do some rewriting of the URL to eventually make it "ws://" or "wss://",                               // 5
// whatever was passed in.  At the very least, what Meteor.absoluteUrl() returns                            // 6
// us should work.                                                                                          // 7
//                                                                                                          // 8
// We don't do any heartbeating. (The logic that did this in sockjs was removed,                            // 9
// because it used a built-in sockjs mechanism. We could do it with WebSocket                               // 10
// ping frames or with DDP-level messages.)                                                                 // 11
LivedataTest.ClientStream = function (endpoint) {                                                           // 12
  var self = this;                                                                                          // 13
                                                                                                            // 14
  // WebSocket-Node https://github.com/Worlize/WebSocket-Node                                               // 15
  // Chosen because it can run without native components. It has a                                          // 16
  // somewhat idiosyncratic API. We may want to use 'ws' instead in the                                     // 17
  // future.                                                                                                // 18
  //                                                                                                        // 19
  // Since server-to-server DDP is still an experimental feature, we only                                   // 20
  // require the module if we actually create a server-to-server                                            // 21
  // connection. This is a minor efficiency improvement, but moreover: while                                // 22
  // 'websocket' doesn't require native components, it tries to use some                                    // 23
  // optional native components and prints a warning if it can't load                                       // 24
  // them. Since native components in packages don't work when transferred to                               // 25
  // other architectures yet, this means that require('websocket') prints a                                 // 26
  // spammy log message when deployed to another architecture. Delaying the                                 // 27
  // require means you only get the log message if you're actually using the                                // 28
  // feature.                                                                                               // 29
  self.client = new (Npm.require('websocket').client)();                                                    // 30
  self.endpoint = endpoint;                                                                                 // 31
  self.currentConnection = null;                                                                            // 32
                                                                                                            // 33
  self.client.on('connect', function (connection) {                                                         // 34
    return self._onConnect(connection);                                                                     // 35
  });                                                                                                       // 36
                                                                                                            // 37
  self.client.on('connectFailed', function (error) {                                                        // 38
    // XXX: Make this do something better than make the tests hang if it does not work.                     // 39
    return self._lostConnection();                                                                          // 40
  });                                                                                                       // 41
                                                                                                            // 42
  self._initCommon();                                                                                       // 43
                                                                                                            // 44
  self.expectingWelcome = false;                                                                            // 45
  //// Kickoff!                                                                                             // 46
  self._launchConnection();                                                                                 // 47
};                                                                                                          // 48
                                                                                                            // 49
_.extend(LivedataTest.ClientStream.prototype, {                                                             // 50
                                                                                                            // 51
  // data is a utf8 string. Data sent while not connected is dropped on                                     // 52
  // the floor, and it is up the user of this API to retransmit lost                                        // 53
  // messages on 'reset'                                                                                    // 54
  send: function (data) {                                                                                   // 55
    var self = this;                                                                                        // 56
    if (self.currentStatus.connected) {                                                                     // 57
      self.currentConnection.send(data);                                                                    // 58
    }                                                                                                       // 59
  },                                                                                                        // 60
                                                                                                            // 61
  // Changes where this connection points                                                                   // 62
  _changeUrl: function (url) {                                                                              // 63
    var self = this;                                                                                        // 64
    self.endpoint = url;                                                                                    // 65
  },                                                                                                        // 66
                                                                                                            // 67
  _onConnect: function (connection) {                                                                       // 68
    var self = this;                                                                                        // 69
                                                                                                            // 70
    if (self._forcedToDisconnect) {                                                                         // 71
      // We were asked to disconnect between trying to open the connection and                              // 72
      // actually opening it. Let's just pretend this never happened.                                       // 73
      connection.close();                                                                                   // 74
      return;                                                                                               // 75
    }                                                                                                       // 76
                                                                                                            // 77
    if (self.currentStatus.connected) {                                                                     // 78
      // We already have a connection. It must have been the case that                                      // 79
      // we started two parallel connection attempts (because we                                            // 80
      // wanted to 'reconnect now' on a hanging connection and we had                                       // 81
      // no way to cancel the connection attempt.) Just ignore/close                                        // 82
      // the latecomer.                                                                                     // 83
      connection.close();                                                                                   // 84
      return;                                                                                               // 85
    }                                                                                                       // 86
                                                                                                            // 87
    if (self.connectionTimer) {                                                                             // 88
      clearTimeout(self.connectionTimer);                                                                   // 89
      self.connectionTimer = null;                                                                          // 90
    }                                                                                                       // 91
                                                                                                            // 92
    connection.on('error', function (error) {                                                               // 93
      if (self.currentConnection !== this)                                                                  // 94
        return;                                                                                             // 95
                                                                                                            // 96
      Meteor._debug("stream error", error.toString(),                                                       // 97
                    (new Date()).toDateString());                                                           // 98
      self._lostConnection();                                                                               // 99
    });                                                                                                     // 100
                                                                                                            // 101
    connection.on('close', function () {                                                                    // 102
      if (self.currentConnection !== this)                                                                  // 103
        return;                                                                                             // 104
                                                                                                            // 105
      self._lostConnection();                                                                               // 106
    });                                                                                                     // 107
                                                                                                            // 108
    self.expectingWelcome = true;                                                                           // 109
    connection.on('message', function (message) {                                                           // 110
      if (self.currentConnection !== this)                                                                  // 111
        return; // old connection still emitting messages                                                   // 112
                                                                                                            // 113
      if (self.expectingWelcome) {                                                                          // 114
        // Discard the first message that comes across the                                                  // 115
        // connection. It is the hot code push version identifier and                                       // 116
        // is not actually part of DDP.                                                                     // 117
        self.expectingWelcome = false;                                                                      // 118
        return;                                                                                             // 119
      }                                                                                                     // 120
                                                                                                            // 121
      if (message.type === "utf8") // ignore binary frames                                                  // 122
        _.each(self.eventCallbacks.message, function (callback) {                                           // 123
          callback(message.utf8Data);                                                                       // 124
        });                                                                                                 // 125
    });                                                                                                     // 126
                                                                                                            // 127
    // update status                                                                                        // 128
    self.currentConnection = connection;                                                                    // 129
    self.currentStatus.status = "connected";                                                                // 130
    self.currentStatus.connected = true;                                                                    // 131
    self.currentStatus.retryCount = 0;                                                                      // 132
    self.statusChanged();                                                                                   // 133
                                                                                                            // 134
    // fire resets. This must come after status change so that clients                                      // 135
    // can call send from within a reset callback.                                                          // 136
    _.each(self.eventCallbacks.reset, function (callback) { callback(); });                                 // 137
  },                                                                                                        // 138
                                                                                                            // 139
  _cleanup: function () {                                                                                   // 140
    var self = this;                                                                                        // 141
                                                                                                            // 142
    self._clearConnectionTimer();                                                                           // 143
    if (self.currentConnection) {                                                                           // 144
      self.currentConnection.close();                                                                       // 145
      self.currentConnection = null;                                                                        // 146
    }                                                                                                       // 147
  },                                                                                                        // 148
                                                                                                            // 149
  _clearConnectionTimer: function () {                                                                      // 150
    var self = this;                                                                                        // 151
                                                                                                            // 152
    if (self.connectionTimer) {                                                                             // 153
      clearTimeout(self.connectionTimer);                                                                   // 154
      self.connectionTimer = null;                                                                          // 155
    }                                                                                                       // 156
  },                                                                                                        // 157
                                                                                                            // 158
  _launchConnection: function () {                                                                          // 159
    var self = this;                                                                                        // 160
    self._cleanup(); // cleanup the old socket, if there was one.                                           // 161
                                                                                                            // 162
    // launch a connect attempt. we have no way to track it. we either                                      // 163
    // get an _onConnect event, or we don't.                                                                // 164
                                                                                                            // 165
    // XXX: set up a timeout on this.                                                                       // 166
                                                                                                            // 167
    // we would like to specify 'ddp' as the protocol here, but                                             // 168
    // unfortunately WebSocket-Node fails the handshake if we ask for                                       // 169
    // a protocol and the server doesn't send one back (and sockjs                                          // 170
    // doesn't). also, related: I guess we have to accept that                                              // 171
    // 'stream' is ddp-specific                                                                             // 172
    self.client.connect(toWebsocketUrl(self.endpoint));                                                     // 173
                                                                                                            // 174
    if (self.connectionTimer)                                                                               // 175
      clearTimeout(self.connectionTimer);                                                                   // 176
    self.connectionTimer = setTimeout(                                                                      // 177
      _.bind(self._lostConnection, self),                                                                   // 178
      self.CONNECT_TIMEOUT);                                                                                // 179
  }                                                                                                         // 180
});                                                                                                         // 181
                                                                                                            // 182
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/stream_client_common.js                                                                //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
// XXX from Underscore.String (http://epeli.github.com/underscore.string/)                                  // 1
var startsWith = function(str, starts) {                                                                    // 2
  return str.length >= starts.length &&                                                                     // 3
    str.substring(0, starts.length) === starts;                                                             // 4
};                                                                                                          // 5
var endsWith = function(str, ends) {                                                                        // 6
  return str.length >= ends.length &&                                                                       // 7
    str.substring(str.length - ends.length) === ends;                                                       // 8
};                                                                                                          // 9
                                                                                                            // 10
// @param url {String} URL to Meteor app, eg:                                                               // 11
//   "/" or "madewith.meteor.com" or "https://foo.meteor.com"                                               // 12
//   or "ddp+sockjs://ddp--****-foo.meteor.com/sockjs"                                                      // 13
// @returns {String} URL to the endpoint with the specific scheme and subPath, e.g.                         // 14
// for scheme "http" and subPath "sockjs"                                                                   // 15
//   "http://subdomain.meteor.com/sockjs" or "/sockjs"                                                      // 16
//   or "https://ddp--1234-foo.meteor.com/sockjs"                                                           // 17
var translateUrl =  function(url, newSchemeBase, subPath) {                                                 // 18
  if (! newSchemeBase) {                                                                                    // 19
    newSchemeBase = "http";                                                                                 // 20
  }                                                                                                         // 21
                                                                                                            // 22
  var ddpUrlMatch = url.match(/^ddp(i?)\+sockjs:\/\//);                                                     // 23
  var httpUrlMatch = url.match(/^http(s?):\/\//);                                                           // 24
  var newScheme;                                                                                            // 25
  if (ddpUrlMatch) {                                                                                        // 26
    // Remove scheme and split off the host.                                                                // 27
    var urlAfterDDP = url.substr(ddpUrlMatch[0].length);                                                    // 28
    newScheme = ddpUrlMatch[1] === "i" ? newSchemeBase : newSchemeBase + "s";                               // 29
    var slashPos = urlAfterDDP.indexOf('/');                                                                // 30
    var host =                                                                                              // 31
          slashPos === -1 ? urlAfterDDP : urlAfterDDP.substr(0, slashPos);                                  // 32
    var rest = slashPos === -1 ? '' : urlAfterDDP.substr(slashPos);                                         // 33
                                                                                                            // 34
    // In the host (ONLY!), change '*' characters into random digits. This                                  // 35
    // allows different stream connections to connect to different hostnames                                // 36
    // and avoid browser per-hostname connection limits.                                                    // 37
    host = host.replace(/\*/g, function () {                                                                // 38
      return Math.floor(Random.fraction()*10);                                                              // 39
    });                                                                                                     // 40
                                                                                                            // 41
    return newScheme + '://' + host + rest;                                                                 // 42
  } else if (httpUrlMatch) {                                                                                // 43
    newScheme = !httpUrlMatch[1] ? newSchemeBase : newSchemeBase + "s";                                     // 44
    var urlAfterHttp = url.substr(httpUrlMatch[0].length);                                                  // 45
    url = newScheme + "://" + urlAfterHttp;                                                                 // 46
  }                                                                                                         // 47
                                                                                                            // 48
  // Prefix FQDNs but not relative URLs                                                                     // 49
  if (url.indexOf("://") === -1 && !startsWith(url, "/")) {                                                 // 50
    url = newSchemeBase + "://" + url;                                                                      // 51
  }                                                                                                         // 52
                                                                                                            // 53
  url = Meteor._relativeToSiteRootUrl(url);                                                                 // 54
                                                                                                            // 55
  if (endsWith(url, "/"))                                                                                   // 56
    return url + subPath;                                                                                   // 57
  else                                                                                                      // 58
    return url + "/" + subPath;                                                                             // 59
};                                                                                                          // 60
                                                                                                            // 61
toSockjsUrl = function (url) {                                                                              // 62
  return translateUrl(url, "http", "sockjs");                                                               // 63
};                                                                                                          // 64
                                                                                                            // 65
toWebsocketUrl = function (url) {                                                                           // 66
  var ret = translateUrl(url, "ws", "websocket");                                                           // 67
  return ret;                                                                                               // 68
};                                                                                                          // 69
                                                                                                            // 70
LivedataTest.toSockjsUrl = toSockjsUrl;                                                                     // 71
                                                                                                            // 72
                                                                                                            // 73
_.extend(LivedataTest.ClientStream.prototype, {                                                             // 74
                                                                                                            // 75
  // Register for callbacks.                                                                                // 76
  on: function (name, callback) {                                                                           // 77
    var self = this;                                                                                        // 78
                                                                                                            // 79
    if (name !== 'message' && name !== 'reset' && name !== 'update_available')                              // 80
      throw new Error("unknown event type: " + name);                                                       // 81
                                                                                                            // 82
    if (!self.eventCallbacks[name])                                                                         // 83
      self.eventCallbacks[name] = [];                                                                       // 84
    self.eventCallbacks[name].push(callback);                                                               // 85
  },                                                                                                        // 86
                                                                                                            // 87
                                                                                                            // 88
  _initCommon: function () {                                                                                // 89
    var self = this;                                                                                        // 90
    //// Constants                                                                                          // 91
                                                                                                            // 92
    // how long to wait until we declare the connection attempt                                             // 93
    // failed.                                                                                              // 94
    self.CONNECT_TIMEOUT = 10000;                                                                           // 95
                                                                                                            // 96
                                                                                                            // 97
    // time for initial reconnect attempt.                                                                  // 98
    self.RETRY_BASE_TIMEOUT = 1000;                                                                         // 99
    // exponential factor to increase timeout each attempt.                                                 // 100
    self.RETRY_EXPONENT = 2.2;                                                                              // 101
    // maximum time between reconnects. keep this intentionally                                             // 102
    // high-ish to ensure a server can recover from a failure caused                                        // 103
    // by load                                                                                              // 104
    self.RETRY_MAX_TIMEOUT = 5 * 60000; // 5 minutes                                                        // 105
    // time to wait for the first 2 retries.  this helps page reload                                        // 106
    // speed during dev mode restarts, but doesn't hurt prod too                                            // 107
    // much (due to CONNECT_TIMEOUT)                                                                        // 108
    self.RETRY_MIN_TIMEOUT = 10;                                                                            // 109
    // how many times to try to reconnect 'instantly'                                                       // 110
    self.RETRY_MIN_COUNT = 2;                                                                               // 111
    // fuzz factor to randomize reconnect times by. avoid reconnect                                         // 112
    // storms.                                                                                              // 113
    self.RETRY_FUZZ = 0.5; // +- 25%                                                                        // 114
                                                                                                            // 115
                                                                                                            // 116
                                                                                                            // 117
    self.eventCallbacks = {}; // name -> [callback]                                                         // 118
                                                                                                            // 119
    self._forcedToDisconnect = false;                                                                       // 120
                                                                                                            // 121
    //// Reactive status                                                                                    // 122
    self.currentStatus = {                                                                                  // 123
      status: "connecting",                                                                                 // 124
      connected: false,                                                                                     // 125
      retryCount: 0                                                                                         // 126
    };                                                                                                      // 127
                                                                                                            // 128
                                                                                                            // 129
    self.statusListeners = typeof Deps !== 'undefined' && new Deps.Dependency;                              // 130
    self.statusChanged = function () {                                                                      // 131
      if (self.statusListeners)                                                                             // 132
        self.statusListeners.changed();                                                                     // 133
    };                                                                                                      // 134
                                                                                                            // 135
    //// Retry logic                                                                                        // 136
    self.retryTimer = null;                                                                                 // 137
    self.connectionTimer = null;                                                                            // 138
                                                                                                            // 139
  },                                                                                                        // 140
                                                                                                            // 141
  // Trigger a reconnect.                                                                                   // 142
  reconnect: function (options) {                                                                           // 143
    var self = this;                                                                                        // 144
    options = options || {};                                                                                // 145
                                                                                                            // 146
    if (options.url) {                                                                                      // 147
      self._changeUrl(options.url);                                                                         // 148
    }                                                                                                       // 149
                                                                                                            // 150
    if (self.currentStatus.connected) {                                                                     // 151
      if (options._force || options.url) {                                                                  // 152
        // force reconnect.                                                                                 // 153
        self._lostConnection();                                                                             // 154
      } // else, noop.                                                                                      // 155
      return;                                                                                               // 156
    }                                                                                                       // 157
                                                                                                            // 158
    // if we're mid-connection, stop it.                                                                    // 159
    if (self.currentStatus.status === "connecting") {                                                       // 160
      self._lostConnection();                                                                               // 161
    }                                                                                                       // 162
                                                                                                            // 163
    if (self.retryTimer)                                                                                    // 164
      clearTimeout(self.retryTimer);                                                                        // 165
    self.retryTimer = null;                                                                                 // 166
    self.currentStatus.retryCount -= 1; // don't count manual retries                                       // 167
    self._retryNow();                                                                                       // 168
  },                                                                                                        // 169
                                                                                                            // 170
  disconnect: function (options) {                                                                          // 171
    var self = this;                                                                                        // 172
    options = options || {};                                                                                // 173
                                                                                                            // 174
    // Failed is permanent. If we're failed, don't let people go back                                       // 175
    // online by calling 'disconnect' then 'reconnect'.                                                     // 176
    if (self._forcedToDisconnect)                                                                           // 177
      return;                                                                                               // 178
                                                                                                            // 179
    // If _permanent is set, permanently disconnect a stream. Once a stream                                 // 180
    // is forced to disconnect, it can never reconnect. This is for                                         // 181
    // error cases such as ddp version mismatch, where trying again                                         // 182
    // won't fix the problem.                                                                               // 183
    if (options._permanent) {                                                                               // 184
      self._forcedToDisconnect = true;                                                                      // 185
    }                                                                                                       // 186
                                                                                                            // 187
    self._cleanup();                                                                                        // 188
    if (self.retryTimer) {                                                                                  // 189
      clearTimeout(self.retryTimer);                                                                        // 190
      self.retryTimer = null;                                                                               // 191
    }                                                                                                       // 192
                                                                                                            // 193
    self.currentStatus = {                                                                                  // 194
      status: (options._permanent ? "failed" : "offline"),                                                  // 195
      connected: false,                                                                                     // 196
      retryCount: 0                                                                                         // 197
    };                                                                                                      // 198
                                                                                                            // 199
    if (options._permanent && options._error)                                                               // 200
      self.currentStatus.reason = options._error;                                                           // 201
                                                                                                            // 202
    self.statusChanged();                                                                                   // 203
  },                                                                                                        // 204
                                                                                                            // 205
  _lostConnection: function () {                                                                            // 206
    var self = this;                                                                                        // 207
                                                                                                            // 208
    self._cleanup();                                                                                        // 209
    self._retryLater(); // sets status. no need to do it here.                                              // 210
  },                                                                                                        // 211
                                                                                                            // 212
  _retryTimeout: function (count) {                                                                         // 213
    var self = this;                                                                                        // 214
                                                                                                            // 215
    if (count < self.RETRY_MIN_COUNT)                                                                       // 216
      return self.RETRY_MIN_TIMEOUT;                                                                        // 217
                                                                                                            // 218
    var timeout = Math.min(                                                                                 // 219
      self.RETRY_MAX_TIMEOUT,                                                                               // 220
      self.RETRY_BASE_TIMEOUT * Math.pow(self.RETRY_EXPONENT, count));                                      // 221
    // fuzz the timeout randomly, to avoid reconnect storms when a                                          // 222
    // server goes down.                                                                                    // 223
    timeout = timeout * ((Random.fraction() * self.RETRY_FUZZ) +                                            // 224
                         (1 - self.RETRY_FUZZ/2));                                                          // 225
    return timeout;                                                                                         // 226
  },                                                                                                        // 227
                                                                                                            // 228
  // fired when we detect that we've gone online. try to reconnect                                          // 229
  // immediately.                                                                                           // 230
  _online: function () {                                                                                    // 231
    // if we've requested to be offline by disconnecting, don't reconnect.                                  // 232
    if (this.currentStatus.status != "offline")                                                             // 233
      this.reconnect();                                                                                     // 234
  },                                                                                                        // 235
                                                                                                            // 236
  _retryLater: function () {                                                                                // 237
    var self = this;                                                                                        // 238
                                                                                                            // 239
    var timeout = self._retryTimeout(self.currentStatus.retryCount);                                        // 240
    if (self.retryTimer)                                                                                    // 241
      clearTimeout(self.retryTimer);                                                                        // 242
    self.retryTimer = setTimeout(_.bind(self._retryNow, self), timeout);                                    // 243
                                                                                                            // 244
    self.currentStatus.status = "waiting";                                                                  // 245
    self.currentStatus.connected = false;                                                                   // 246
    self.currentStatus.retryTime = (new Date()).getTime() + timeout;                                        // 247
    self.statusChanged();                                                                                   // 248
  },                                                                                                        // 249
                                                                                                            // 250
  _retryNow: function () {                                                                                  // 251
    var self = this;                                                                                        // 252
                                                                                                            // 253
    if (self._forcedToDisconnect)                                                                           // 254
      return;                                                                                               // 255
                                                                                                            // 256
    self.currentStatus.retryCount += 1;                                                                     // 257
    self.currentStatus.status = "connecting";                                                               // 258
    self.currentStatus.connected = false;                                                                   // 259
    delete self.currentStatus.retryTime;                                                                    // 260
    self.statusChanged();                                                                                   // 261
                                                                                                            // 262
    self._launchConnection();                                                                               // 263
  },                                                                                                        // 264
                                                                                                            // 265
                                                                                                            // 266
  // Get current status. Reactive.                                                                          // 267
  status: function () {                                                                                     // 268
    var self = this;                                                                                        // 269
    if (self.statusListeners)                                                                               // 270
      self.statusListeners.depend();                                                                        // 271
    return self.currentStatus;                                                                              // 272
  }                                                                                                         // 273
});                                                                                                         // 274
                                                                                                            // 275
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/stream_server.js                                                                       //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
// unique id for this instantiation of the server. If this changes                                          // 1
// between client reconnects, the client will reload. You can set the                                       // 2
// environment variable "SERVER_ID" to control this. For example, if                                        // 3
// you want to only force a reload on major changes, you can use a                                          // 4
// custom serverId which you only change when something worth pushing                                       // 5
// to clients immediately happens.                                                                          // 6
__meteor_runtime_config__.serverId =                                                                        // 7
  process.env.SERVER_ID ? process.env.SERVER_ID : Random.id();                                              // 8
                                                                                                            // 9
var pathPrefix = __meteor_runtime_config__.ROOT_URL_PATH_PREFIX ||  "";                                     // 10
                                                                                                            // 11
StreamServer = function () {                                                                                // 12
  var self = this;                                                                                          // 13
  self.registration_callbacks = [];                                                                         // 14
  self.open_sockets = [];                                                                                   // 15
                                                                                                            // 16
  // Because we are installing directly onto WebApp.httpServer instead of using                             // 17
  // WebApp.app, we have to process the path prefix ourselves.                                              // 18
  self.prefix = pathPrefix + '/sockjs';                                                                     // 19
  // routepolicy is only a weak dependency, because we don't need it if we're                               // 20
  // just doing server-to-server DDP as a client.                                                           // 21
  if (Package.routepolicy) {                                                                                // 22
    Package.routepolicy.RoutePolicy.declare(self.prefix + '/', 'network');                                  // 23
  }                                                                                                         // 24
                                                                                                            // 25
  // set up sockjs                                                                                          // 26
  var sockjs = Npm.require('sockjs');                                                                       // 27
  var serverOptions = {                                                                                     // 28
    prefix: self.prefix,                                                                                    // 29
    log: function() {},                                                                                     // 30
    // this is the default, but we code it explicitly because we depend                                     // 31
    // on it in stream_client:HEARTBEAT_TIMEOUT                                                             // 32
    heartbeat_delay: 25000,                                                                                 // 33
    // The default disconnect_delay is 5 seconds, but if the server ends up CPU                             // 34
    // bound for that much time, SockJS might not notice that the user has                                  // 35
    // reconnected because the timer (of disconnect_delay ms) can fire before                               // 36
    // SockJS processes the new connection. Eventually we'll fix this by not                                // 37
    // combining CPU-heavy processing with SockJS termination (eg a proxy which                             // 38
    // converts to Unix sockets) but for now, raise the delay.                                              // 39
    disconnect_delay: 60 * 1000,                                                                            // 40
    jsessionid: false                                                                                       // 41
  };                                                                                                        // 42
                                                                                                            // 43
  // If you know your server environment (eg, proxies) will prevent websockets                              // 44
  // from ever working, set $DISABLE_WEBSOCKETS and SockJS clients (ie,                                     // 45
  // browsers) will not waste time attempting to use them.                                                  // 46
  // (Your server will still have a /websocket endpoint.)                                                   // 47
  if (process.env.DISABLE_WEBSOCKETS)                                                                       // 48
    serverOptions.websocket = false;                                                                        // 49
                                                                                                            // 50
  self.server = sockjs.createServer(serverOptions);                                                         // 51
  if (!Package.webapp) {                                                                                    // 52
    throw new Error("Cannot create a DDP server without the webapp package");                               // 53
  }                                                                                                         // 54
  self.server.installHandlers(Package.webapp.WebApp.httpServer);                                            // 55
                                                                                                            // 56
  // Support the /websocket endpoint                                                                        // 57
  self._redirectWebsocketEndpoint();                                                                        // 58
                                                                                                            // 59
  self.server.on('connection', function (socket) {                                                          // 60
    socket.send = function (data) {                                                                         // 61
      socket.write(data);                                                                                   // 62
    };                                                                                                      // 63
    socket.on('close', function () {                                                                        // 64
      self.open_sockets = _.without(self.open_sockets, socket);                                             // 65
    });                                                                                                     // 66
    self.open_sockets.push(socket);                                                                         // 67
                                                                                                            // 68
                                                                                                            // 69
    // Send a welcome message with the serverId. Client uses this to                                        // 70
    // reload if needed.                                                                                    // 71
    socket.send(JSON.stringify({server_id: __meteor_runtime_config__.serverId}));                           // 72
                                                                                                            // 73
    // call all our callbacks when we get a new socket. they will do the                                    // 74
    // work of setting up handlers and such for specific messages.                                          // 75
    _.each(self.registration_callbacks, function (callback) {                                               // 76
      callback(socket);                                                                                     // 77
    });                                                                                                     // 78
  });                                                                                                       // 79
                                                                                                            // 80
};                                                                                                          // 81
                                                                                                            // 82
_.extend(StreamServer.prototype, {                                                                          // 83
  // call my callback when a new socket connects.                                                           // 84
  // also call it for all current connections.                                                              // 85
  register: function (callback) {                                                                           // 86
    var self = this;                                                                                        // 87
    self.registration_callbacks.push(callback);                                                             // 88
    _.each(self.all_sockets(), function (socket) {                                                          // 89
      callback(socket);                                                                                     // 90
    });                                                                                                     // 91
  },                                                                                                        // 92
                                                                                                            // 93
  // get a list of all sockets                                                                              // 94
  all_sockets: function () {                                                                                // 95
    var self = this;                                                                                        // 96
    return _.values(self.open_sockets);                                                                     // 97
  },                                                                                                        // 98
                                                                                                            // 99
  // Redirect /websocket to /sockjs/websocket in order to not expose                                        // 100
  // sockjs to clients that want to use raw websockets                                                      // 101
  _redirectWebsocketEndpoint: function() {                                                                  // 102
    var self = this;                                                                                        // 103
    // Unfortunately we can't use a connect middleware here since                                           // 104
    // sockjs installs itself prior to all existing listeners                                               // 105
    // (meaning prior to any connect middlewares) so we need to take                                        // 106
    // an approach similar to overshadowListeners in                                                        // 107
    // https://github.com/sockjs/sockjs-node/blob/cf820c55af6a9953e16558555a31decea554f70e/src/utils.coffee // 108
    _.each(['request', 'upgrade'], function(event) {                                                        // 109
      var httpServer = Package.webapp.WebApp.httpServer;                                                    // 110
      var oldHttpServerListeners = httpServer.listeners(event).slice(0);                                    // 111
      httpServer.removeAllListeners(event);                                                                 // 112
                                                                                                            // 113
      // request and upgrade have different arguments passed but                                            // 114
      // we only care about the first one which is always request                                           // 115
      var newListener = function(request /*, moreArguments */) {                                            // 116
        // Store arguments for use within the closure below                                                 // 117
        var args = arguments;                                                                               // 118
                                                                                                            // 119
        if (request.url === pathPrefix + '/websocket' ||                                                    // 120
            request.url === pathPrefix + '/websocket/') {                                                   // 121
          request.url = self.prefix + '/websocket';                                                         // 122
        }                                                                                                   // 123
        _.each(oldHttpServerListeners, function(oldListener) {                                              // 124
          oldListener.apply(httpServer, args);                                                              // 125
        });                                                                                                 // 126
      };                                                                                                    // 127
      httpServer.addListener(event, newListener);                                                           // 128
    });                                                                                                     // 129
  }                                                                                                         // 130
});                                                                                                         // 131
                                                                                                            // 132
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/livedata_server.js                                                                     //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
DDPServer = {};                                                                                             // 1
                                                                                                            // 2
var Fiber = Npm.require('fibers');                                                                          // 3
                                                                                                            // 4
// This file contains classes:                                                                              // 5
// * Session - The server's connection to a single DDP client                                               // 6
// * Subscription - A single subscription for a single client                                               // 7
// * Server - An entire server that may talk to > 1 client. A DDP endpoint.                                 // 8
//                                                                                                          // 9
// Session and Subscription are file scope. For now, until we freeze                                        // 10
// the interface, Server is package scope (in the future it should be                                       // 11
// exported.)                                                                                               // 12
                                                                                                            // 13
// Represents a single document in a SessionCollectionView                                                  // 14
var SessionDocumentView = function () {                                                                     // 15
  var self = this;                                                                                          // 16
  self.existsIn = {}; // set of subscriptionHandle                                                          // 17
  self.dataByKey = {}; // key-> [ {subscriptionHandle, value} by precedence]                                // 18
};                                                                                                          // 19
                                                                                                            // 20
_.extend(SessionDocumentView.prototype, {                                                                   // 21
                                                                                                            // 22
  getFields: function () {                                                                                  // 23
    var self = this;                                                                                        // 24
    var ret = {};                                                                                           // 25
    _.each(self.dataByKey, function (precedenceList, key) {                                                 // 26
      ret[key] = precedenceList[0].value;                                                                   // 27
    });                                                                                                     // 28
    return ret;                                                                                             // 29
  },                                                                                                        // 30
                                                                                                            // 31
  clearField: function (subscriptionHandle, key, changeCollector) {                                         // 32
    var self = this;                                                                                        // 33
    // Publish API ignores _id if present in fields                                                         // 34
    if (key === "_id")                                                                                      // 35
      return;                                                                                               // 36
    var precedenceList = self.dataByKey[key];                                                               // 37
                                                                                                            // 38
    // It's okay to clear fields that didn't exist. No need to throw                                        // 39
    // an error.                                                                                            // 40
    if (!precedenceList)                                                                                    // 41
      return;                                                                                               // 42
                                                                                                            // 43
    var removedValue = undefined;                                                                           // 44
    for (var i = 0; i < precedenceList.length; i++) {                                                       // 45
      var precedence = precedenceList[i];                                                                   // 46
      if (precedence.subscriptionHandle === subscriptionHandle) {                                           // 47
        // The view's value can only change if this subscription is the one that                            // 48
        // used to have precedence.                                                                         // 49
        if (i === 0)                                                                                        // 50
          removedValue = precedence.value;                                                                  // 51
        precedenceList.splice(i, 1);                                                                        // 52
        break;                                                                                              // 53
      }                                                                                                     // 54
    }                                                                                                       // 55
    if (_.isEmpty(precedenceList)) {                                                                        // 56
      delete self.dataByKey[key];                                                                           // 57
      changeCollector[key] = undefined;                                                                     // 58
    } else if (removedValue !== undefined &&                                                                // 59
               !EJSON.equals(removedValue, precedenceList[0].value)) {                                      // 60
      changeCollector[key] = precedenceList[0].value;                                                       // 61
    }                                                                                                       // 62
  },                                                                                                        // 63
                                                                                                            // 64
  changeField: function (subscriptionHandle, key, value,                                                    // 65
                         changeCollector, isAdd) {                                                          // 66
    var self = this;                                                                                        // 67
    // Publish API ignores _id if present in fields                                                         // 68
    if (key === "_id")                                                                                      // 69
      return;                                                                                               // 70
    if (!_.has(self.dataByKey, key)) {                                                                      // 71
      self.dataByKey[key] = [{subscriptionHandle: subscriptionHandle,                                       // 72
                              value: value}];                                                               // 73
      changeCollector[key] = value;                                                                         // 74
      return;                                                                                               // 75
    }                                                                                                       // 76
    var precedenceList = self.dataByKey[key];                                                               // 77
    var elt;                                                                                                // 78
    if (!isAdd) {                                                                                           // 79
      elt = _.find(precedenceList, function (precedence) {                                                  // 80
        return precedence.subscriptionHandle === subscriptionHandle;                                        // 81
      });                                                                                                   // 82
    }                                                                                                       // 83
                                                                                                            // 84
    if (elt) {                                                                                              // 85
      if (elt === precedenceList[0] && !EJSON.equals(value, elt.value)) {                                   // 86
        // this subscription is changing the value of this field.                                           // 87
        changeCollector[key] = value;                                                                       // 88
      }                                                                                                     // 89
      elt.value = value;                                                                                    // 90
    } else {                                                                                                // 91
      // this subscription is newly caring about this field                                                 // 92
      precedenceList.push({subscriptionHandle: subscriptionHandle, value: value});                          // 93
    }                                                                                                       // 94
                                                                                                            // 95
  }                                                                                                         // 96
});                                                                                                         // 97
                                                                                                            // 98
// Represents a client's view of a single collection                                                        // 99
var SessionCollectionView = function (collectionName, sessionCallbacks) {                                   // 100
  var self = this;                                                                                          // 101
  self.collectionName = collectionName;                                                                     // 102
  self.documents = {};                                                                                      // 103
  self.callbacks = sessionCallbacks;                                                                        // 104
};                                                                                                          // 105
                                                                                                            // 106
LivedataTest.SessionCollectionView = SessionCollectionView;                                                 // 107
                                                                                                            // 108
                                                                                                            // 109
_.extend(SessionCollectionView.prototype, {                                                                 // 110
                                                                                                            // 111
  isEmpty: function () {                                                                                    // 112
    var self = this;                                                                                        // 113
    return _.isEmpty(self.documents);                                                                       // 114
  },                                                                                                        // 115
                                                                                                            // 116
  diff: function (previous) {                                                                               // 117
    var self = this;                                                                                        // 118
    LocalCollection._diffObjects(previous.documents, self.documents, {                                      // 119
      both: _.bind(self.diffDocument, self),                                                                // 120
                                                                                                            // 121
      rightOnly: function (id, nowDV) {                                                                     // 122
        self.callbacks.added(self.collectionName, id, nowDV.getFields());                                   // 123
      },                                                                                                    // 124
                                                                                                            // 125
      leftOnly: function (id, prevDV) {                                                                     // 126
        self.callbacks.removed(self.collectionName, id);                                                    // 127
      }                                                                                                     // 128
    });                                                                                                     // 129
  },                                                                                                        // 130
                                                                                                            // 131
  diffDocument: function (id, prevDV, nowDV) {                                                              // 132
    var self = this;                                                                                        // 133
    var fields = {};                                                                                        // 134
    LocalCollection._diffObjects(prevDV.getFields(), nowDV.getFields(), {                                   // 135
      both: function (key, prev, now) {                                                                     // 136
        if (!EJSON.equals(prev, now))                                                                       // 137
          fields[key] = now;                                                                                // 138
      },                                                                                                    // 139
      rightOnly: function (key, now) {                                                                      // 140
        fields[key] = now;                                                                                  // 141
      },                                                                                                    // 142
      leftOnly: function(key, prev) {                                                                       // 143
        fields[key] = undefined;                                                                            // 144
      }                                                                                                     // 145
    });                                                                                                     // 146
    self.callbacks.changed(self.collectionName, id, fields);                                                // 147
  },                                                                                                        // 148
                                                                                                            // 149
  added: function (subscriptionHandle, id, fields) {                                                        // 150
    var self = this;                                                                                        // 151
    var docView = self.documents[id];                                                                       // 152
    var added = false;                                                                                      // 153
    if (!docView) {                                                                                         // 154
      added = true;                                                                                         // 155
      docView = new SessionDocumentView();                                                                  // 156
      self.documents[id] = docView;                                                                         // 157
    }                                                                                                       // 158
    docView.existsIn[subscriptionHandle] = true;                                                            // 159
    var changeCollector = {};                                                                               // 160
    _.each(fields, function (value, key) {                                                                  // 161
      docView.changeField(                                                                                  // 162
        subscriptionHandle, key, value, changeCollector, true);                                             // 163
    });                                                                                                     // 164
    if (added)                                                                                              // 165
      self.callbacks.added(self.collectionName, id, changeCollector);                                       // 166
    else                                                                                                    // 167
      self.callbacks.changed(self.collectionName, id, changeCollector);                                     // 168
  },                                                                                                        // 169
                                                                                                            // 170
  changed: function (subscriptionHandle, id, changed) {                                                     // 171
    var self = this;                                                                                        // 172
    var changedResult = {};                                                                                 // 173
    var docView = self.documents[id];                                                                       // 174
    if (!docView)                                                                                           // 175
      throw new Error("Could not find element with id " + id + " to change");                               // 176
    _.each(changed, function (value, key) {                                                                 // 177
      if (value === undefined)                                                                              // 178
        docView.clearField(subscriptionHandle, key, changedResult);                                         // 179
      else                                                                                                  // 180
        docView.changeField(subscriptionHandle, key, value, changedResult);                                 // 181
    });                                                                                                     // 182
    self.callbacks.changed(self.collectionName, id, changedResult);                                         // 183
  },                                                                                                        // 184
                                                                                                            // 185
  removed: function (subscriptionHandle, id) {                                                              // 186
    var self = this;                                                                                        // 187
    var docView = self.documents[id];                                                                       // 188
    if (!docView) {                                                                                         // 189
      var err = new Error("Removed nonexistent document " + id);                                            // 190
      throw err;                                                                                            // 191
    }                                                                                                       // 192
    delete docView.existsIn[subscriptionHandle];                                                            // 193
    if (_.isEmpty(docView.existsIn)) {                                                                      // 194
      // it is gone from everyone                                                                           // 195
      self.callbacks.removed(self.collectionName, id);                                                      // 196
      delete self.documents[id];                                                                            // 197
    } else {                                                                                                // 198
      var changed = {};                                                                                     // 199
      // remove this subscription from every precedence list                                                // 200
      // and record the changes                                                                             // 201
      _.each(docView.dataByKey, function (precedenceList, key) {                                            // 202
        docView.clearField(subscriptionHandle, key, changed);                                               // 203
      });                                                                                                   // 204
                                                                                                            // 205
      self.callbacks.changed(self.collectionName, id, changed);                                             // 206
    }                                                                                                       // 207
  }                                                                                                         // 208
});                                                                                                         // 209
                                                                                                            // 210
/******************************************************************************/                            // 211
/* Session                                                                    */                            // 212
/******************************************************************************/                            // 213
                                                                                                            // 214
var Session = function (server, version) {                                                                  // 215
  var self = this;                                                                                          // 216
  self.id = Random.id();                                                                                    // 217
                                                                                                            // 218
  self.server = server;                                                                                     // 219
  self.version = version;                                                                                   // 220
                                                                                                            // 221
  self.initialized = false;                                                                                 // 222
  self.socket = null;                                                                                       // 223
  self.last_connect_time = 0;                                                                               // 224
  self.last_detach_time = +(new Date);                                                                      // 225
                                                                                                            // 226
  self.in_queue = [];                                                                                       // 227
  self.blocked = false;                                                                                     // 228
  self.worker_running = false;                                                                              // 229
                                                                                                            // 230
  self.out_queue = [];                                                                                      // 231
                                                                                                            // 232
  // id of invocation => {result or error, when}                                                            // 233
  self.result_cache = {};                                                                                   // 234
                                                                                                            // 235
  // Sub objects for active subscriptions                                                                   // 236
  self._namedSubs = {};                                                                                     // 237
  self._universalSubs = [];                                                                                 // 238
                                                                                                            // 239
  self.userId = null;                                                                                       // 240
                                                                                                            // 241
  // Per-connection scratch area. This is only used internally, but we                                      // 242
  // should have real and documented API for this sort of thing someday.                                    // 243
  self.sessionData = {};                                                                                    // 244
                                                                                                            // 245
  self.collectionViews = {};                                                                                // 246
                                                                                                            // 247
  // Set this to false to not send messages when collectionViews are                                        // 248
  // modified. This is done when rerunning subs in _setUserId and those messages                            // 249
  // are calculated via a diff instead.                                                                     // 250
  self._isSending = true;                                                                                   // 251
                                                                                                            // 252
  // If this is true, don't start a newly-created universal publisher on this                               // 253
  // session. The session will take care of starting it when appropriate.                                   // 254
  self._dontStartNewUniversalSubs = false;                                                                  // 255
                                                                                                            // 256
  // when we are rerunning subscriptions, any ready messages                                                // 257
  // we want to buffer up for when we are done rerunning subscriptions                                      // 258
  self._pendingReady = [];                                                                                  // 259
};                                                                                                          // 260
                                                                                                            // 261
_.extend(Session.prototype, {                                                                               // 262
                                                                                                            // 263
                                                                                                            // 264
  sendReady: function (subscriptionIds) {                                                                   // 265
    var self = this;                                                                                        // 266
    if (self._isSending)                                                                                    // 267
      self.send({msg: "ready", subs: subscriptionIds});                                                     // 268
    else {                                                                                                  // 269
      _.each(subscriptionIds, function (subscriptionId) {                                                   // 270
        self._pendingReady.push(subscriptionId);                                                            // 271
      });                                                                                                   // 272
    }                                                                                                       // 273
  },                                                                                                        // 274
                                                                                                            // 275
  sendAdded: function (collectionName, id, fields) {                                                        // 276
    var self = this;                                                                                        // 277
    if (self._isSending)                                                                                    // 278
      self.send({msg: "added", collection: collectionName, id: id, fields: fields});                        // 279
  },                                                                                                        // 280
                                                                                                            // 281
  sendChanged: function (collectionName, id, fields) {                                                      // 282
    var self = this;                                                                                        // 283
    if (_.isEmpty(fields))                                                                                  // 284
      return;                                                                                               // 285
                                                                                                            // 286
    if (self._isSending) {                                                                                  // 287
      self.send({                                                                                           // 288
        msg: "changed",                                                                                     // 289
        collection: collectionName,                                                                         // 290
        id: id,                                                                                             // 291
        fields: fields                                                                                      // 292
      });                                                                                                   // 293
    }                                                                                                       // 294
  },                                                                                                        // 295
                                                                                                            // 296
  sendRemoved: function (collectionName, id) {                                                              // 297
    var self = this;                                                                                        // 298
    if (self._isSending)                                                                                    // 299
      self.send({msg: "removed", collection: collectionName, id: id});                                      // 300
  },                                                                                                        // 301
                                                                                                            // 302
  getSendCallbacks: function () {                                                                           // 303
    var self = this;                                                                                        // 304
    return {                                                                                                // 305
      added: _.bind(self.sendAdded, self),                                                                  // 306
      changed: _.bind(self.sendChanged, self),                                                              // 307
      removed: _.bind(self.sendRemoved, self)                                                               // 308
    };                                                                                                      // 309
  },                                                                                                        // 310
                                                                                                            // 311
  getCollectionView: function (collectionName) {                                                            // 312
    var self = this;                                                                                        // 313
    if (_.has(self.collectionViews, collectionName)) {                                                      // 314
      return self.collectionViews[collectionName];                                                          // 315
    }                                                                                                       // 316
    var ret = new SessionCollectionView(collectionName,                                                     // 317
                                        self.getSendCallbacks());                                           // 318
    self.collectionViews[collectionName] = ret;                                                             // 319
    return ret;                                                                                             // 320
  },                                                                                                        // 321
                                                                                                            // 322
  added: function (subscriptionHandle, collectionName, id, fields) {                                        // 323
    var self = this;                                                                                        // 324
    var view = self.getCollectionView(collectionName);                                                      // 325
    view.added(subscriptionHandle, id, fields);                                                             // 326
  },                                                                                                        // 327
                                                                                                            // 328
  removed: function (subscriptionHandle, collectionName, id) {                                              // 329
    var self = this;                                                                                        // 330
    var view = self.getCollectionView(collectionName);                                                      // 331
    view.removed(subscriptionHandle, id);                                                                   // 332
    if (view.isEmpty()) {                                                                                   // 333
      delete self.collectionViews[collectionName];                                                          // 334
    }                                                                                                       // 335
  },                                                                                                        // 336
                                                                                                            // 337
  changed: function (subscriptionHandle, collectionName, id, fields) {                                      // 338
    var self = this;                                                                                        // 339
    var view = self.getCollectionView(collectionName);                                                      // 340
    view.changed(subscriptionHandle, id, fields);                                                           // 341
  },                                                                                                        // 342
  // Connect a new socket to this session, displacing (and closing)                                         // 343
  // any socket that was previously connected                                                               // 344
  connect: function (socket) {                                                                              // 345
    var self = this;                                                                                        // 346
    if (self.socket) {                                                                                      // 347
      self.socket.close();                                                                                  // 348
      self.detach(self.socket);                                                                             // 349
    }                                                                                                       // 350
                                                                                                            // 351
    self.socket = socket;                                                                                   // 352
    self.last_connect_time = +(new Date);                                                                   // 353
    _.each(self.out_queue, function (msg) {                                                                 // 354
      if (Meteor._printSentDDP)                                                                             // 355
        Meteor._debug("Sent DDP", stringifyDDP(msg));                                                       // 356
      self.socket.send(stringifyDDP(msg));                                                                  // 357
    });                                                                                                     // 358
    self.out_queue = [];                                                                                    // 359
                                                                                                            // 360
    // On initial connect, spin up all the universal publishers.                                            // 361
    if (!self.initialized) {                                                                                // 362
      self.initialized = true;                                                                              // 363
      Fiber(function () {                                                                                   // 364
        self.startUniversalSubs();                                                                          // 365
      }).run();                                                                                             // 366
    }                                                                                                       // 367
  },                                                                                                        // 368
                                                                                                            // 369
  startUniversalSubs: function () {                                                                         // 370
    var self = this;                                                                                        // 371
    // Make a shallow copy of the set of universal handlers and start them. If                              // 372
    // additional universal publishers start while we're running them (due to                               // 373
    // yielding), they will run separately as part of Server.publish.                                       // 374
    var handlers = _.clone(self.server.universal_publish_handlers);                                         // 375
    _.each(handlers, function (handler) {                                                                   // 376
      self._startSubscription(handler);                                                                     // 377
    });                                                                                                     // 378
  },                                                                                                        // 379
                                                                                                            // 380
  // If 'socket' is the socket currently connected to this session,                                         // 381
  // detach it (the session will then have no socket -- it will                                             // 382
  // continue running and queue up its messages.) If 'socket' isn't                                         // 383
  // the currently connected socket, just clean up the pointer that                                         // 384
  // may have led us to believe otherwise.                                                                  // 385
  detach: function (socket) {                                                                               // 386
    var self = this;                                                                                        // 387
    if (socket === self.socket) {                                                                           // 388
      self.socket = null;                                                                                   // 389
      self.last_detach_time = +(new Date);                                                                  // 390
    }                                                                                                       // 391
    if (socket.meteor_session === self)                                                                     // 392
      socket.meteor_session = null;                                                                         // 393
  },                                                                                                        // 394
                                                                                                            // 395
  // Should be called periodically to prune the method invocation                                           // 396
  // replay cache.                                                                                          // 397
  cleanup: function () {                                                                                    // 398
    var self = this;                                                                                        // 399
    // Only prune if we're connected, and we've been connected for at                                       // 400
    // least five minutes. That seems like enough time for the client                                       // 401
    // to finish its reconnection. Then, keep five minutes of                                               // 402
    // history. That seems like enough time for the client to receive                                       // 403
    // our responses, or else for us to notice that the connection is                                       // 404
    // gone.                                                                                                // 405
    var now = +(new Date);                                                                                  // 406
    if (!(self.socket && (now - self.last_connect_time) > 5 * 60 * 1000))                                   // 407
      return; // not connected, or not connected long enough                                                // 408
                                                                                                            // 409
    var kill = [];                                                                                          // 410
    _.each(self.result_cache, function (info, id) {                                                         // 411
      if (now - info.when > 5 * 60 * 1000)                                                                  // 412
        kill.push(id);                                                                                      // 413
    });                                                                                                     // 414
    _.each(kill, function (id) {                                                                            // 415
      delete self.result_cache[id];                                                                         // 416
    });                                                                                                     // 417
  },                                                                                                        // 418
                                                                                                            // 419
  // Destroy this session. Stop all processing and tear everything                                          // 420
  // down. If a socket was attached, close it.                                                              // 421
  destroy: function () {                                                                                    // 422
    var self = this;                                                                                        // 423
    if (self.socket) {                                                                                      // 424
      self.socket.close();                                                                                  // 425
      self.detach(self.socket);                                                                             // 426
    }                                                                                                       // 427
    self._deactivateAllSubscriptions();                                                                     // 428
    // Drop the merge box data immediately.                                                                 // 429
    self.collectionViews = {};                                                                              // 430
    self.in_queue = self.out_queue = [];                                                                    // 431
  },                                                                                                        // 432
                                                                                                            // 433
  // Send a message (queueing it if no socket is connected right now.)                                      // 434
  // It should be a JSON object (it will be stringified.)                                                   // 435
  send: function (msg) {                                                                                    // 436
    var self = this;                                                                                        // 437
    if (Meteor._printSentDDP)                                                                               // 438
      Meteor._debug("Sent DDP", stringifyDDP(msg));                                                         // 439
    if (self.socket)                                                                                        // 440
      self.socket.send(stringifyDDP(msg));                                                                  // 441
    else                                                                                                    // 442
      self.out_queue.push(msg);                                                                             // 443
  },                                                                                                        // 444
                                                                                                            // 445
  // Send a connection error.                                                                               // 446
  sendError: function (reason, offendingMessage) {                                                          // 447
    var self = this;                                                                                        // 448
    var msg = {msg: 'error', reason: reason};                                                               // 449
    if (offendingMessage)                                                                                   // 450
      msg.offendingMessage = offendingMessage;                                                              // 451
    self.send(msg);                                                                                         // 452
  },                                                                                                        // 453
                                                                                                            // 454
  // Process 'msg' as an incoming message. (But as a guard against                                          // 455
  // race conditions during reconnection, ignore the message if                                             // 456
  // 'socket' is not the currently connected socket.)                                                       // 457
  //                                                                                                        // 458
  // We run the messages from the client one at a time, in the order                                        // 459
  // given by the client. The message handler is passed an idempotent                                       // 460
  // function 'unblock' which it may call to allow other messages to                                        // 461
  // begin running in parallel in another fiber (for example, a method                                      // 462
  // that wants to yield.) Otherwise, it is automatically unblocked                                         // 463
  // when it returns.                                                                                       // 464
  //                                                                                                        // 465
  // Actually, we don't have to 'totally order' the messages in this                                        // 466
  // way, but it's the easiest thing that's correct. (unsub needs to                                        // 467
  // be ordered against sub, methods need to be ordered against each                                        // 468
  // other.)                                                                                                // 469
  processMessage: function (msg_in, socket) {                                                               // 470
    var self = this;                                                                                        // 471
    if (socket !== self.socket)                                                                             // 472
      return;                                                                                               // 473
                                                                                                            // 474
    self.in_queue.push(msg_in);                                                                             // 475
    if (self.worker_running)                                                                                // 476
      return;                                                                                               // 477
    self.worker_running = true;                                                                             // 478
                                                                                                            // 479
    var processNext = function () {                                                                         // 480
      var msg = self.in_queue.shift();                                                                      // 481
      if (!msg) {                                                                                           // 482
        self.worker_running = false;                                                                        // 483
        return;                                                                                             // 484
      }                                                                                                     // 485
                                                                                                            // 486
      Fiber(function () {                                                                                   // 487
        var blocked = true;                                                                                 // 488
                                                                                                            // 489
        var unblock = function () {                                                                         // 490
          if (!blocked)                                                                                     // 491
            return; // idempotent                                                                           // 492
          blocked = false;                                                                                  // 493
          processNext();                                                                                    // 494
        };                                                                                                  // 495
                                                                                                            // 496
        if (_.has(self.protocol_handlers, msg.msg))                                                         // 497
          self.protocol_handlers[msg.msg].call(self, msg, unblock);                                         // 498
        else                                                                                                // 499
          self.sendError('Bad request', msg);                                                               // 500
        unblock(); // in case the handler didn't already do it                                              // 501
      }).run();                                                                                             // 502
    };                                                                                                      // 503
                                                                                                            // 504
    processNext();                                                                                          // 505
  },                                                                                                        // 506
                                                                                                            // 507
  protocol_handlers: {                                                                                      // 508
    sub: function (msg) {                                                                                   // 509
      var self = this;                                                                                      // 510
                                                                                                            // 511
      // reject malformed messages                                                                          // 512
      if (typeof (msg.id) !== "string" ||                                                                   // 513
          typeof (msg.name) !== "string" ||                                                                 // 514
          (('params' in msg) && !(msg.params instanceof Array))) {                                          // 515
        self.sendError("Malformed subscription", msg);                                                      // 516
        return;                                                                                             // 517
      }                                                                                                     // 518
                                                                                                            // 519
      if (!self.server.publish_handlers[msg.name]) {                                                        // 520
        self.send({                                                                                         // 521
          msg: 'nosub', id: msg.id,                                                                         // 522
          error: new Meteor.Error(404, "Subscription not found")});                                         // 523
        return;                                                                                             // 524
      }                                                                                                     // 525
                                                                                                            // 526
      if (_.has(self._namedSubs, msg.id))                                                                   // 527
        // subs are idempotent, or rather, they are ignored if a sub                                        // 528
        // with that id already exists. this is important during                                            // 529
        // reconnect.                                                                                       // 530
        return;                                                                                             // 531
                                                                                                            // 532
      var handler = self.server.publish_handlers[msg.name];                                                 // 533
      self._startSubscription(handler, msg.id, msg.params, msg.name);                                       // 534
                                                                                                            // 535
    },                                                                                                      // 536
                                                                                                            // 537
    unsub: function (msg) {                                                                                 // 538
      var self = this;                                                                                      // 539
                                                                                                            // 540
      self._stopSubscription(msg.id);                                                                       // 541
    },                                                                                                      // 542
                                                                                                            // 543
    method: function (msg, unblock) {                                                                       // 544
      var self = this;                                                                                      // 545
                                                                                                            // 546
      // reject malformed messages                                                                          // 547
      // XXX should also reject messages with unknown attributes?                                           // 548
      if (typeof (msg.id) !== "string" ||                                                                   // 549
          typeof (msg.method) !== "string" ||                                                               // 550
          (('params' in msg) && !(msg.params instanceof Array))) {                                          // 551
        self.sendError("Malformed method invocation", msg);                                                 // 552
        return;                                                                                             // 553
      }                                                                                                     // 554
                                                                                                            // 555
      // set up to mark the method as satisfied once all observers                                          // 556
      // (and subscriptions) have reacted to any writes that were                                           // 557
      // done.                                                                                              // 558
      var fence = new DDPServer._WriteFence;                                                                // 559
      fence.onAllCommitted(function () {                                                                    // 560
        // Retire the fence so that future writes are allowed.                                              // 561
        // This means that callbacks like timers are free to use                                            // 562
        // the fence, and if they fire before it's armed (for                                               // 563
        // example, because the method waits for them) their                                                // 564
        // writes will be included in the fence.                                                            // 565
        fence.retire();                                                                                     // 566
        self.send({                                                                                         // 567
          msg: 'updated', methods: [msg.id]});                                                              // 568
      });                                                                                                   // 569
                                                                                                            // 570
      // check for a replayed method (this is important during                                              // 571
      // reconnect)                                                                                         // 572
      if (_.has(self.result_cache, msg.id)) {                                                               // 573
        // found -- just resend whatever we sent last time                                                  // 574
        var payload = _.clone(self.result_cache[msg.id]);                                                   // 575
        delete payload.when;                                                                                // 576
        self.send(                                                                                          // 577
          _.extend({msg: 'result', id: msg.id}, payload));                                                  // 578
        fence.arm();                                                                                        // 579
        return;                                                                                             // 580
      }                                                                                                     // 581
                                                                                                            // 582
      // find the handler                                                                                   // 583
      var handler = self.server.method_handlers[msg.method];                                                // 584
      if (!handler) {                                                                                       // 585
        self.send({                                                                                         // 586
          msg: 'result', id: msg.id,                                                                        // 587
          error: new Meteor.Error(404, "Method not found")});                                               // 588
        fence.arm();                                                                                        // 589
        return;                                                                                             // 590
      }                                                                                                     // 591
                                                                                                            // 592
      var setUserId = function(userId) {                                                                    // 593
        self._setUserId(userId);                                                                            // 594
      };                                                                                                    // 595
                                                                                                            // 596
      var invocation = new MethodInvocation({                                                               // 597
        isSimulation: false,                                                                                // 598
        userId: self.userId, setUserId: setUserId,                                                          // 599
        unblock: unblock,                                                                                   // 600
        sessionData: self.sessionData                                                                       // 601
      });                                                                                                   // 602
      try {                                                                                                 // 603
        var result = DDPServer._CurrentWriteFence.withValue(fence, function () {                            // 604
          return DDP._CurrentInvocation.withValue(invocation, function () {                                 // 605
            return maybeAuditArgumentChecks(                                                                // 606
              handler, invocation, msg.params, "call to '" + msg.method + "'");                             // 607
          });                                                                                               // 608
        });                                                                                                 // 609
      } catch (e) {                                                                                         // 610
        var exception = e;                                                                                  // 611
      }                                                                                                     // 612
                                                                                                            // 613
      fence.arm(); // we're done adding writes to the fence                                                 // 614
      unblock(); // unblock, if the method hasn't done it already                                           // 615
                                                                                                            // 616
      exception = wrapInternalException(                                                                    // 617
        exception, "while invoking method '" + msg.method + "'");                                           // 618
                                                                                                            // 619
      // send response and add to cache                                                                     // 620
      var payload =                                                                                         // 621
        exception ? {error: exception} : (result !== undefined ?                                            // 622
                                          {result: result} : {});                                           // 623
      self.result_cache[msg.id] = _.extend({when: +(new Date)}, payload);                                   // 624
      self.send(_.extend({msg: 'result', id: msg.id}, payload));                                            // 625
    }                                                                                                       // 626
  },                                                                                                        // 627
                                                                                                            // 628
  _eachSub: function (f) {                                                                                  // 629
    var self = this;                                                                                        // 630
    _.each(self._namedSubs, f);                                                                             // 631
    _.each(self._universalSubs, f);                                                                         // 632
  },                                                                                                        // 633
                                                                                                            // 634
  _diffCollectionViews: function (beforeCVs) {                                                              // 635
    var self = this;                                                                                        // 636
    LocalCollection._diffObjects(beforeCVs, self.collectionViews, {                                         // 637
      both: function (collectionName, leftValue, rightValue) {                                              // 638
        rightValue.diff(leftValue);                                                                         // 639
      },                                                                                                    // 640
      rightOnly: function (collectionName, rightValue) {                                                    // 641
        _.each(rightValue.documents, function (docView, id) {                                               // 642
          self.sendAdded(collectionName, id, docView.getFields());                                          // 643
        });                                                                                                 // 644
      },                                                                                                    // 645
      leftOnly: function (collectionName, leftValue) {                                                      // 646
        _.each(leftValue.documents, function (doc, id) {                                                    // 647
          self.sendRemoved(collectionName, id);                                                             // 648
        });                                                                                                 // 649
      }                                                                                                     // 650
    });                                                                                                     // 651
  },                                                                                                        // 652
                                                                                                            // 653
  // Sets the current user id in all appropriate contexts and reruns                                        // 654
  // all subscriptions                                                                                      // 655
  _setUserId: function(userId) {                                                                            // 656
    var self = this;                                                                                        // 657
                                                                                                            // 658
    if (userId !== null && typeof userId !== "string")                                                      // 659
      throw new Error("setUserId must be called on string or null, not " +                                  // 660
                      typeof userId);                                                                       // 661
                                                                                                            // 662
    // Prevent newly-created universal subscriptions from being added to our                                // 663
    // session; they will be found below when we call startUniversalSubs.                                   // 664
    //                                                                                                      // 665
    // (We don't have to worry about named subscriptions, because we only add                               // 666
    // them when we process a 'sub' message. We are currently processing a                                  // 667
    // 'method' message, and the method did not unblock, because it is illegal                              // 668
    // to call setUserId after unblock. Thus we cannot be concurrently adding a                             // 669
    // new named subscription.)                                                                             // 670
    self._dontStartNewUniversalSubs = true;                                                                 // 671
                                                                                                            // 672
    // Prevent current subs from updating our collectionViews and call their                                // 673
    // stop callbacks. This may yield.                                                                      // 674
    self._eachSub(function (sub) {                                                                          // 675
      sub._deactivate();                                                                                    // 676
    });                                                                                                     // 677
                                                                                                            // 678
    // All subs should now be deactivated. Stop sending messages to the client,                             // 679
    // save the state of the published collections, reset to an empty view, and                             // 680
    // update the userId.                                                                                   // 681
    self._isSending = false;                                                                                // 682
    var beforeCVs = self.collectionViews;                                                                   // 683
    self.collectionViews = {};                                                                              // 684
    self.userId = userId;                                                                                   // 685
                                                                                                            // 686
    // Save the old named subs, and reset to having no subscriptions.                                       // 687
    var oldNamedSubs = self._namedSubs;                                                                     // 688
    self._namedSubs = {};                                                                                   // 689
    self._universalSubs = [];                                                                               // 690
                                                                                                            // 691
    _.each(oldNamedSubs, function (sub, subscriptionId) {                                                   // 692
      self._namedSubs[subscriptionId] = sub._recreate();                                                    // 693
      // nb: if the handler throws or calls this.error(), it will in fact                                   // 694
      // immediately send its 'nosub'. This is OK, though.                                                  // 695
      self._namedSubs[subscriptionId]._runHandler();                                                        // 696
    });                                                                                                     // 697
                                                                                                            // 698
    // Allow newly-created universal subs to be started on our connection in                                // 699
    // parallel with the ones we're spinning up here, and spin up universal                                 // 700
    // subs.                                                                                                // 701
    self._dontStartNewUniversalSubs = false;                                                                // 702
    self.startUniversalSubs();                                                                              // 703
                                                                                                            // 704
    // Start sending messages again, beginning with the diff from the previous                              // 705
    // state of the world to the current state. No yields are allowed during                                // 706
    // this diff, so that other changes cannot interleave.                                                  // 707
    Meteor._noYieldsAllowed(function () {                                                                   // 708
      self._isSending = true;                                                                               // 709
      self._diffCollectionViews(beforeCVs);                                                                 // 710
      if (!_.isEmpty(self._pendingReady)) {                                                                 // 711
        self.sendReady(self._pendingReady);                                                                 // 712
        self._pendingReady = [];                                                                            // 713
      }                                                                                                     // 714
    });                                                                                                     // 715
                                                                                                            // 716
    // XXX figure out the login token that was just used, and set up an observe                             // 717
    // on the user doc so that deleting the user or the login token disconnects                             // 718
    // the session. For now, if you want to make sure that your deleted users                               // 719
    // don't have any continuing sessions, you can restart the server, but we                               // 720
    // should make it automatic.                                                                            // 721
  },                                                                                                        // 722
                                                                                                            // 723
  _startSubscription: function (handler, subId, params, name) {                                             // 724
    var self = this;                                                                                        // 725
                                                                                                            // 726
    var sub = new Subscription(                                                                             // 727
      self, handler, subId, params, name);                                                                  // 728
    if (subId)                                                                                              // 729
      self._namedSubs[subId] = sub;                                                                         // 730
    else                                                                                                    // 731
      self._universalSubs.push(sub);                                                                        // 732
                                                                                                            // 733
    sub._runHandler();                                                                                      // 734
  },                                                                                                        // 735
                                                                                                            // 736
  // tear down specified subscription                                                                       // 737
  _stopSubscription: function (subId, error) {                                                              // 738
    var self = this;                                                                                        // 739
                                                                                                            // 740
    if (subId && self._namedSubs[subId]) {                                                                  // 741
      self._namedSubs[subId]._removeAllDocuments();                                                         // 742
      self._namedSubs[subId]._deactivate();                                                                 // 743
      delete self._namedSubs[subId];                                                                        // 744
    }                                                                                                       // 745
                                                                                                            // 746
    var response = {msg: 'nosub', id: subId};                                                               // 747
                                                                                                            // 748
    if (error)                                                                                              // 749
      response.error = wrapInternalException(error, "from sub " + subId);                                   // 750
                                                                                                            // 751
    self.send(response);                                                                                    // 752
  },                                                                                                        // 753
                                                                                                            // 754
  // tear down all subscriptions. Note that this does NOT send removed or nosub                             // 755
  // messages, since we assume the client is gone.                                                          // 756
  _deactivateAllSubscriptions: function () {                                                                // 757
    var self = this;                                                                                        // 758
                                                                                                            // 759
    _.each(self._namedSubs, function (sub, id) {                                                            // 760
      sub._deactivate();                                                                                    // 761
    });                                                                                                     // 762
    self._namedSubs = {};                                                                                   // 763
                                                                                                            // 764
    _.each(self._universalSubs, function (sub) {                                                            // 765
      sub._deactivate();                                                                                    // 766
    });                                                                                                     // 767
    self._universalSubs = [];                                                                               // 768
  }                                                                                                         // 769
                                                                                                            // 770
});                                                                                                         // 771
                                                                                                            // 772
/******************************************************************************/                            // 773
/* Subscription                                                               */                            // 774
/******************************************************************************/                            // 775
                                                                                                            // 776
// ctor for a sub handle: the input to each publish function                                                // 777
var Subscription = function (                                                                               // 778
    session, handler, subscriptionId, params, name) {                                                       // 779
  var self = this;                                                                                          // 780
  self._session = session; // type is Session                                                               // 781
                                                                                                            // 782
  self._handler = handler;                                                                                  // 783
                                                                                                            // 784
  // my subscription ID (generated by client, undefined for universal subs).                                // 785
  self._subscriptionId = subscriptionId;                                                                    // 786
  // undefined for universal subs                                                                           // 787
  self._name = name;                                                                                        // 788
                                                                                                            // 789
  self._params = params || [];                                                                              // 790
                                                                                                            // 791
  // Only named subscriptions have IDs, but we need some sort of string                                     // 792
  // internally to keep track of all subscriptions inside                                                   // 793
  // SessionDocumentViews. We use this subscriptionHandle for that.                                         // 794
  if (self._subscriptionId) {                                                                               // 795
    self._subscriptionHandle = 'N' + self._subscriptionId;                                                  // 796
  } else {                                                                                                  // 797
    self._subscriptionHandle = 'U' + Random.id();                                                           // 798
  }                                                                                                         // 799
                                                                                                            // 800
  // has _deactivate been called?                                                                           // 801
  self._deactivated = false;                                                                                // 802
                                                                                                            // 803
  // stop callbacks to g/c this sub.  called w/ zero arguments.                                             // 804
  self._stopCallbacks = [];                                                                                 // 805
                                                                                                            // 806
  // the set of (collection, documentid) that this subscription has                                         // 807
  // an opinion about                                                                                       // 808
  self._documents = {};                                                                                     // 809
                                                                                                            // 810
  // remember if we are ready.                                                                              // 811
  self._ready = false;                                                                                      // 812
                                                                                                            // 813
  // Part of the public API: the user of this sub.                                                          // 814
  self.userId = session.userId;                                                                             // 815
                                                                                                            // 816
  // For now, the id filter is going to default to                                                          // 817
  // the to/from DDP methods on LocalCollection, to                                                         // 818
  // specifically deal with mongo/minimongo ObjectIds.                                                      // 819
                                                                                                            // 820
  // Later, you will be able to make this be "raw"                                                          // 821
  // if you want to publish a collection that you know                                                      // 822
  // just has strings for keys and no funny business, to                                                    // 823
  // a ddp consumer that isn't minimongo                                                                    // 824
                                                                                                            // 825
  self._idFilter = {                                                                                        // 826
    idStringify: LocalCollection._idStringify,                                                              // 827
    idParse: LocalCollection._idParse                                                                       // 828
  };                                                                                                        // 829
};                                                                                                          // 830
                                                                                                            // 831
_.extend(Subscription.prototype, {                                                                          // 832
  _runHandler: function () {                                                                                // 833
    var self = this;                                                                                        // 834
    try {                                                                                                   // 835
      var res = maybeAuditArgumentChecks(                                                                   // 836
        self._handler, self, EJSON.clone(self._params),                                                     // 837
        "publisher '" + self._name + "'");                                                                  // 838
    } catch (e) {                                                                                           // 839
      self.error(e);                                                                                        // 840
      return;                                                                                               // 841
    }                                                                                                       // 842
                                                                                                            // 843
    // Did the handler call this.error or this.stop?                                                        // 844
    if (self._deactivated)                                                                                  // 845
      return;                                                                                               // 846
                                                                                                            // 847
    // SPECIAL CASE: Instead of writing their own callbacks that invoke                                     // 848
    // this.added/changed/ready/etc, the user can just return a collection                                  // 849
    // cursor or array of cursors from the publish function; we call their                                  // 850
    // _publishCursor method which starts observing the cursor and publishes the                            // 851
    // results. Note that _publishCursor does NOT call ready().                                             // 852
    //                                                                                                      // 853
    // XXX This uses an undocumented interface which only the Mongo cursor                                  // 854
    // interface publishes. Should we make this interface public and encourage                              // 855
    // users to implement it themselves? Arguably, it's unnecessary; users can                              // 856
    // already write their own functions like                                                               // 857
    //   var publishMyReactiveThingy = function (name, handler) {                                           // 858
    //     Meteor.publish(name, function () {                                                               // 859
    //       var reactiveThingy = handler();                                                                // 860
    //       reactiveThingy.publishMe();                                                                    // 861
    //     });                                                                                              // 862
    //   };                                                                                                 // 863
    var isCursor = function (c) {                                                                           // 864
      return c && c._publishCursor;                                                                         // 865
    };                                                                                                      // 866
    if (isCursor(res)) {                                                                                    // 867
      res._publishCursor(self);                                                                             // 868
      // _publishCursor only returns after the initial added callbacks have run.                            // 869
      // mark subscription as ready.                                                                        // 870
      self.ready();                                                                                         // 871
    } else if (_.isArray(res)) {                                                                            // 872
      // check all the elements are cursors                                                                 // 873
      if (! _.all(res, isCursor)) {                                                                         // 874
        self.error(new Error("Publish function returned an array of non-Cursors"));                         // 875
        return;                                                                                             // 876
      }                                                                                                     // 877
      // find duplicate collection names                                                                    // 878
      // XXX we should support overlapping cursors, but that would require the                              // 879
      // merge box to allow overlap within a subscription                                                   // 880
      var collectionNames = {};                                                                             // 881
      for (var i = 0; i < res.length; ++i) {                                                                // 882
        var collectionName = res[i]._getCollectionName();                                                   // 883
        if (_.has(collectionNames, collectionName)) {                                                       // 884
          self.error(new Error(                                                                             // 885
            "Publish function returned multiple cursors for collection " +                                  // 886
              collectionName));                                                                             // 887
          return;                                                                                           // 888
        }                                                                                                   // 889
        collectionNames[collectionName] = true;                                                             // 890
      };                                                                                                    // 891
                                                                                                            // 892
      _.each(res, function (cur) {                                                                          // 893
        cur._publishCursor(self);                                                                           // 894
      });                                                                                                   // 895
      self.ready();                                                                                         // 896
    }                                                                                                       // 897
  },                                                                                                        // 898
                                                                                                            // 899
  // This calls all stop callbacks and prevents the handler from updating any                               // 900
  // SessionCollectionViews further. It's used when the user unsubscribes or                                // 901
  // disconnects, as well as during setUserId re-runs. It does *NOT* send                                   // 902
  // removed messages for the published objects; if that is necessary, call                                 // 903
  // _removeAllDocuments first.                                                                             // 904
  _deactivate: function() {                                                                                 // 905
    var self = this;                                                                                        // 906
    if (self._deactivated)                                                                                  // 907
      return;                                                                                               // 908
    self._deactivated = true;                                                                               // 909
    self._callStopCallbacks();                                                                              // 910
  },                                                                                                        // 911
                                                                                                            // 912
  _callStopCallbacks: function () {                                                                         // 913
    var self = this;                                                                                        // 914
    // tell listeners, so they can clean up                                                                 // 915
    var callbacks = self._stopCallbacks;                                                                    // 916
    self._stopCallbacks = [];                                                                               // 917
    _.each(callbacks, function (callback) {                                                                 // 918
      callback();                                                                                           // 919
    });                                                                                                     // 920
  },                                                                                                        // 921
                                                                                                            // 922
  // Send remove messages for every document.                                                               // 923
  _removeAllDocuments: function () {                                                                        // 924
    var self = this;                                                                                        // 925
    Meteor._noYieldsAllowed(function () {                                                                   // 926
      _.each(self._documents, function(collectionDocs, collectionName) {                                    // 927
        // Iterate over _.keys instead of the dictionary itself, since we'll be                             // 928
        // mutating it.                                                                                     // 929
        _.each(_.keys(collectionDocs), function (strId) {                                                   // 930
          self.removed(collectionName, self._idFilter.idParse(strId));                                      // 931
        });                                                                                                 // 932
      });                                                                                                   // 933
    });                                                                                                     // 934
  },                                                                                                        // 935
                                                                                                            // 936
  // Returns a new Subscription for the same session with the same                                          // 937
  // initial creation parameters. This isn't a clone: it doesn't have                                       // 938
  // the same _documents cache, stopped state or callbacks; may have a                                      // 939
  // different _subscriptionHandle, and gets its userId from the                                            // 940
  // session, not from this object.                                                                         // 941
  _recreate: function () {                                                                                  // 942
    var self = this;                                                                                        // 943
    return new Subscription(                                                                                // 944
      self._session, self._handler, self._subscriptionId, self._params);                                    // 945
  },                                                                                                        // 946
                                                                                                            // 947
  error: function (error) {                                                                                 // 948
    var self = this;                                                                                        // 949
    if (self._deactivated)                                                                                  // 950
      return;                                                                                               // 951
    self._session._stopSubscription(self._subscriptionId, error);                                           // 952
  },                                                                                                        // 953
                                                                                                            // 954
  // Note that while our DDP client will notice that you've called stop() on the                            // 955
  // server (and clean up its _subscriptions table) we don't actually provide a                             // 956
  // mechanism for an app to notice this (the subscribe onError callback only                               // 957
  // triggers if there is an error).                                                                        // 958
  stop: function () {                                                                                       // 959
    var self = this;                                                                                        // 960
    if (self._deactivated)                                                                                  // 961
      return;                                                                                               // 962
    self._session._stopSubscription(self._subscriptionId);                                                  // 963
  },                                                                                                        // 964
                                                                                                            // 965
  onStop: function (callback) {                                                                             // 966
    var self = this;                                                                                        // 967
    if (self._deactivated)                                                                                  // 968
      callback();                                                                                           // 969
    else                                                                                                    // 970
      self._stopCallbacks.push(callback);                                                                   // 971
  },                                                                                                        // 972
                                                                                                            // 973
  added: function (collectionName, id, fields) {                                                            // 974
    var self = this;                                                                                        // 975
    if (self._deactivated)                                                                                  // 976
      return;                                                                                               // 977
    id = self._idFilter.idStringify(id);                                                                    // 978
    Meteor._ensure(self._documents, collectionName)[id] = true;                                             // 979
    self._session.added(self._subscriptionHandle, collectionName, id, fields);                              // 980
  },                                                                                                        // 981
                                                                                                            // 982
  changed: function (collectionName, id, fields) {                                                          // 983
    var self = this;                                                                                        // 984
    if (self._deactivated)                                                                                  // 985
      return;                                                                                               // 986
    id = self._idFilter.idStringify(id);                                                                    // 987
    self._session.changed(self._subscriptionHandle, collectionName, id, fields);                            // 988
  },                                                                                                        // 989
                                                                                                            // 990
  removed: function (collectionName, id) {                                                                  // 991
    var self = this;                                                                                        // 992
    if (self._deactivated)                                                                                  // 993
      return;                                                                                               // 994
    id = self._idFilter.idStringify(id);                                                                    // 995
    // We don't bother to delete sets of things in a collection if the                                      // 996
    // collection is empty.  It could break _removeAllDocuments.                                            // 997
    delete self._documents[collectionName][id];                                                             // 998
    self._session.removed(self._subscriptionHandle, collectionName, id);                                    // 999
  },                                                                                                        // 1000
                                                                                                            // 1001
  ready: function () {                                                                                      // 1002
    var self = this;                                                                                        // 1003
    if (self._deactivated)                                                                                  // 1004
      return;                                                                                               // 1005
    if (!self._subscriptionId)                                                                              // 1006
      return;  // unnecessary but ignored for universal sub                                                 // 1007
    if (!self._ready) {                                                                                     // 1008
      self._session.sendReady([self._subscriptionId]);                                                      // 1009
      self._ready = true;                                                                                   // 1010
    }                                                                                                       // 1011
  }                                                                                                         // 1012
});                                                                                                         // 1013
                                                                                                            // 1014
/******************************************************************************/                            // 1015
/* Server                                                                     */                            // 1016
/******************************************************************************/                            // 1017
                                                                                                            // 1018
Server = function () {                                                                                      // 1019
  var self = this;                                                                                          // 1020
                                                                                                            // 1021
  self.publish_handlers = {};                                                                               // 1022
  self.universal_publish_handlers = [];                                                                     // 1023
                                                                                                            // 1024
  self.method_handlers = {};                                                                                // 1025
                                                                                                            // 1026
  self.sessions = {}; // map from id to session                                                             // 1027
                                                                                                            // 1028
  self.stream_server = new StreamServer;                                                                    // 1029
                                                                                                            // 1030
  self.stream_server.register(function (socket) {                                                           // 1031
    // socket implements the SockJSConnection interface                                                     // 1032
    socket.meteor_session = null;                                                                           // 1033
                                                                                                            // 1034
    var sendError = function (reason, offendingMessage) {                                                   // 1035
      var msg = {msg: 'error', reason: reason};                                                             // 1036
      if (offendingMessage)                                                                                 // 1037
        msg.offendingMessage = offendingMessage;                                                            // 1038
      socket.send(stringifyDDP(msg));                                                                       // 1039
    };                                                                                                      // 1040
                                                                                                            // 1041
    socket.on('data', function (raw_msg) {                                                                  // 1042
      if (Meteor._printReceivedDDP) {                                                                       // 1043
        Meteor._debug("Received DDP", raw_msg);                                                             // 1044
      }                                                                                                     // 1045
      try {                                                                                                 // 1046
        try {                                                                                               // 1047
          var msg = parseDDP(raw_msg);                                                                      // 1048
        } catch (err) {                                                                                     // 1049
          sendError('Parse error');                                                                         // 1050
          return;                                                                                           // 1051
        }                                                                                                   // 1052
        if (msg === null || !msg.msg) {                                                                     // 1053
          sendError('Bad request', msg);                                                                    // 1054
          return;                                                                                           // 1055
        }                                                                                                   // 1056
                                                                                                            // 1057
        if (msg.msg === 'connect') {                                                                        // 1058
          if (socket.meteor_session) {                                                                      // 1059
            sendError("Already connected", msg);                                                            // 1060
            return;                                                                                         // 1061
          }                                                                                                 // 1062
          self._handleConnect(socket, msg);                                                                 // 1063
          return;                                                                                           // 1064
        }                                                                                                   // 1065
                                                                                                            // 1066
        if (!socket.meteor_session) {                                                                       // 1067
          sendError('Must connect first', msg);                                                             // 1068
          return;                                                                                           // 1069
        }                                                                                                   // 1070
        socket.meteor_session.processMessage(msg, socket);                                                  // 1071
      } catch (e) {                                                                                         // 1072
        // XXX print stack nicely                                                                           // 1073
        Meteor._debug("Internal exception while processing message", msg,                                   // 1074
                      e.stack);                                                                             // 1075
      }                                                                                                     // 1076
    });                                                                                                     // 1077
                                                                                                            // 1078
    socket.on('close', function () {                                                                        // 1079
      if (socket.meteor_session)                                                                            // 1080
        socket.meteor_session.detach(socket);                                                               // 1081
    });                                                                                                     // 1082
  });                                                                                                       // 1083
                                                                                                            // 1084
  // Every minute, clean up sessions that have been abandoned for a                                         // 1085
  // minute. Also run result cache cleanup.                                                                 // 1086
  // XXX at scale, we'll want to have a separate timer for each                                             // 1087
  //     session, and stagger them                                                                          // 1088
  // XXX when we get resume working again, we might keep sessions                                           // 1089
  //     open longer (but stop running their diffs!)                                                        // 1090
  Meteor.setInterval(function () {                                                                          // 1091
    var now = +(new Date);                                                                                  // 1092
    var destroyedIds = [];                                                                                  // 1093
    _.each(self.sessions, function (s, id) {                                                                // 1094
      s.cleanup();                                                                                          // 1095
      if (!s.socket && (now - s.last_detach_time) > 60 * 1000) {                                            // 1096
        s.destroy();                                                                                        // 1097
        destroyedIds.push(id);                                                                              // 1098
      }                                                                                                     // 1099
    });                                                                                                     // 1100
    _.each(destroyedIds, function (id) {                                                                    // 1101
      delete self.sessions[id];                                                                             // 1102
    });                                                                                                     // 1103
  }, 1 * 60 * 1000);                                                                                        // 1104
};                                                                                                          // 1105
                                                                                                            // 1106
_.extend(Server.prototype, {                                                                                // 1107
                                                                                                            // 1108
  _handleConnect: function (socket, msg) {                                                                  // 1109
    var self = this;                                                                                        // 1110
    // In the future, handle session resumption: something like:                                            // 1111
    //  socket.meteor_session = self.sessions[msg.session]                                                  // 1112
    var version = calculateVersion(msg.support, SUPPORTED_DDP_VERSIONS);                                    // 1113
                                                                                                            // 1114
    if (msg.version === version) {                                                                          // 1115
      // Creating a new session                                                                             // 1116
      socket.meteor_session = new Session(self, version);                                                   // 1117
      self.sessions[socket.meteor_session.id] = socket.meteor_session;                                      // 1118
                                                                                                            // 1119
                                                                                                            // 1120
      socket.send(stringifyDDP({msg: 'connected',                                                           // 1121
                                  session: socket.meteor_session.id}));                                     // 1122
      // will kick off previous connection, if any                                                          // 1123
      socket.meteor_session.connect(socket);                                                                // 1124
    } else if (!msg.version) {                                                                              // 1125
      // connect message without a version. This means an old (pre-pre1)                                    // 1126
      // client is trying to connect. If we just disconnect the                                             // 1127
      // connection, they'll retry right away. Instead, just pause for a                                    // 1128
      // bit (randomly distributed so as to avoid synchronized swarms)                                      // 1129
      // and hold the connection open.                                                                      // 1130
      var timeout = 1000 * (30 + Random.fraction() * 60);                                                   // 1131
      // drop all future data coming over this connection on the                                            // 1132
      // floor. We don't want to confuse things.                                                            // 1133
      socket.removeAllListeners('data');                                                                    // 1134
      setTimeout(function () {                                                                              // 1135
        socket.send(stringifyDDP({msg: 'failed', version: version}));                                       // 1136
        socket.close();                                                                                     // 1137
      }, timeout);                                                                                          // 1138
    } else {                                                                                                // 1139
      socket.send(stringifyDDP({msg: 'failed', version: version}));                                         // 1140
      socket.close();                                                                                       // 1141
    }                                                                                                       // 1142
  },                                                                                                        // 1143
  /**                                                                                                       // 1144
   * Register a publish handler function.                                                                   // 1145
   *                                                                                                        // 1146
   * @param name {String} identifier for query                                                              // 1147
   * @param handler {Function} publish handler                                                              // 1148
   * @param options {Object}                                                                                // 1149
   *                                                                                                        // 1150
   * Server will call handler function on each new subscription,                                            // 1151
   * either when receiving DDP sub message for a named subscription, or on                                  // 1152
   * DDP connect for a universal subscription.                                                              // 1153
   *                                                                                                        // 1154
   * If name is null, this will be a subscription that is                                                   // 1155
   * automatically established and permanently on for all connected                                         // 1156
   * client, instead of a subscription that can be turned on and off                                        // 1157
   * with subscribe().                                                                                      // 1158
   *                                                                                                        // 1159
   * options to contain:                                                                                    // 1160
   *  - (mostly internal) is_auto: true if generated automatically                                          // 1161
   *    from an autopublish hook. this is for cosmetic purposes only                                        // 1162
   *    (it lets us determine whether to print a warning suggesting                                         // 1163
   *    that you turn off autopublish.)                                                                     // 1164
   */                                                                                                       // 1165
  publish: function (name, handler, options) {                                                              // 1166
    var self = this;                                                                                        // 1167
                                                                                                            // 1168
    options = options || {};                                                                                // 1169
                                                                                                            // 1170
    if (name && name in self.publish_handlers) {                                                            // 1171
      Meteor._debug("Ignoring duplicate publish named '" + name + "'");                                     // 1172
      return;                                                                                               // 1173
    }                                                                                                       // 1174
                                                                                                            // 1175
    if (Package.autopublish && !options.is_auto) {                                                          // 1176
      // They have autopublish on, yet they're trying to manually                                           // 1177
      // picking stuff to publish. They probably should turn off                                            // 1178
      // autopublish. (This check isn't perfect -- if you create a                                          // 1179
      // publish before you turn on autopublish, it won't catch                                             // 1180
      // it. But this will definitely handle the simple case where                                          // 1181
      // you've added the autopublish package to your app, and are                                          // 1182
      // calling publish from your app code.)                                                               // 1183
      if (!self.warned_about_autopublish) {                                                                 // 1184
        self.warned_about_autopublish = true;                                                               // 1185
        Meteor._debug(                                                                                      // 1186
"** You've set up some data subscriptions with Meteor.publish(), but\n" +                                   // 1187
"** you still have autopublish turned on. Because autopublish is still\n" +                                 // 1188
"** on, your Meteor.publish() calls won't have much effect. All data\n" +                                   // 1189
"** will still be sent to all clients.\n" +                                                                 // 1190
"**\n" +                                                                                                    // 1191
"** Turn off autopublish by removing the autopublish package:\n" +                                          // 1192
"**\n" +                                                                                                    // 1193
"**   $ meteor remove autopublish\n" +                                                                      // 1194
"**\n" +                                                                                                    // 1195
"** .. and make sure you have Meteor.publish() and Meteor.subscribe() calls\n" +                            // 1196
"** for each collection that you want clients to see.\n");                                                  // 1197
      }                                                                                                     // 1198
    }                                                                                                       // 1199
                                                                                                            // 1200
    if (name)                                                                                               // 1201
      self.publish_handlers[name] = handler;                                                                // 1202
    else {                                                                                                  // 1203
      self.universal_publish_handlers.push(handler);                                                        // 1204
      // Spin up the new publisher on any existing session too. Run each                                    // 1205
      // session's subscription in a new Fiber, so that there's no change for                               // 1206
      // self.sessions to change while we're running this loop.                                             // 1207
      _.each(self.sessions, function (session) {                                                            // 1208
        if (!session._dontStartNewUniversalSubs) {                                                          // 1209
          Fiber(function() {                                                                                // 1210
            session._startSubscription(handler);                                                            // 1211
          }).run();                                                                                         // 1212
        }                                                                                                   // 1213
      });                                                                                                   // 1214
    }                                                                                                       // 1215
  },                                                                                                        // 1216
                                                                                                            // 1217
  methods: function (methods) {                                                                             // 1218
    var self = this;                                                                                        // 1219
    _.each(methods, function (func, name) {                                                                 // 1220
      if (self.method_handlers[name])                                                                       // 1221
        throw new Error("A method named '" + name + "' is already defined");                                // 1222
      self.method_handlers[name] = func;                                                                    // 1223
    });                                                                                                     // 1224
  },                                                                                                        // 1225
                                                                                                            // 1226
  call: function (name /*, arguments */) {                                                                  // 1227
    // if it's a function, the last argument is the result callback,                                        // 1228
    // not a parameter to the remote method.                                                                // 1229
    var args = Array.prototype.slice.call(arguments, 1);                                                    // 1230
    if (args.length && typeof args[args.length - 1] === "function")                                         // 1231
      var callback = args.pop();                                                                            // 1232
    return this.apply(name, args, callback);                                                                // 1233
  },                                                                                                        // 1234
                                                                                                            // 1235
  // @param options {Optional Object}                                                                       // 1236
  // @param callback {Optional Function}                                                                    // 1237
  apply: function (name, args, options, callback) {                                                         // 1238
    var self = this;                                                                                        // 1239
                                                                                                            // 1240
    // We were passed 3 arguments. They may be either (name, args, options)                                 // 1241
    // or (name, args, callback)                                                                            // 1242
    if (!callback && typeof options === 'function') {                                                       // 1243
      callback = options;                                                                                   // 1244
      options = {};                                                                                         // 1245
    }                                                                                                       // 1246
    options = options || {};                                                                                // 1247
                                                                                                            // 1248
    if (callback)                                                                                           // 1249
      // It's not really necessary to do this, since we immediately                                         // 1250
      // run the callback in this fiber before returning, but we do it                                      // 1251
      // anyway for regularity.                                                                             // 1252
      callback = Meteor.bindEnvironment(callback, function (e) {                                            // 1253
        // XXX improve error message (and how we report it)                                                 // 1254
        Meteor._debug("Exception while delivering result of invoking '" +                                   // 1255
                      name + "'", e.stack);                                                                 // 1256
      });                                                                                                   // 1257
                                                                                                            // 1258
    // Run the handler                                                                                      // 1259
    var handler = self.method_handlers[name];                                                               // 1260
    var exception;                                                                                          // 1261
    if (!handler) {                                                                                         // 1262
      exception = new Meteor.Error(404, "Method not found");                                                // 1263
    } else {                                                                                                // 1264
      // If this is a method call from within another method, get the                                       // 1265
      // user state from the outer method, otherwise don't allow                                            // 1266
      // setUserId to be called                                                                             // 1267
      var userId = null;                                                                                    // 1268
      var setUserId = function() {                                                                          // 1269
        throw new Error("Can't call setUserId on a server initiated method call");                          // 1270
      };                                                                                                    // 1271
      var currentInvocation = DDP._CurrentInvocation.get();                                                 // 1272
      if (currentInvocation) {                                                                              // 1273
        userId = currentInvocation.userId;                                                                  // 1274
        setUserId = function(userId) {                                                                      // 1275
          currentInvocation.setUserId(userId);                                                              // 1276
        };                                                                                                  // 1277
      }                                                                                                     // 1278
                                                                                                            // 1279
      var invocation = new MethodInvocation({                                                               // 1280
        isSimulation: false,                                                                                // 1281
        userId: userId, setUserId: setUserId,                                                               // 1282
        sessionData: self.sessionData                                                                       // 1283
      });                                                                                                   // 1284
      try {                                                                                                 // 1285
        var result = DDP._CurrentInvocation.withValue(invocation, function () {                             // 1286
          return maybeAuditArgumentChecks(                                                                  // 1287
            handler, invocation, args, "internal call to '" + name + "'");                                  // 1288
        });                                                                                                 // 1289
      } catch (e) {                                                                                         // 1290
        exception = e;                                                                                      // 1291
      }                                                                                                     // 1292
    }                                                                                                       // 1293
                                                                                                            // 1294
    // Return the result in whichever way the caller asked for it. Note that we                             // 1295
    // do NOT block on the write fence in an analogous way to how the client                                // 1296
    // blocks on the relevant data being visible, so you are NOT guaranteed that                            // 1297
    // cursor observe callbacks have fired when your callback is invoked. (We                               // 1298
    // can change this if there's a real use case.)                                                         // 1299
    if (callback) {                                                                                         // 1300
      callback(exception, result);                                                                          // 1301
      return undefined;                                                                                     // 1302
    }                                                                                                       // 1303
    if (exception)                                                                                          // 1304
      throw exception;                                                                                      // 1305
    return result;                                                                                          // 1306
  }                                                                                                         // 1307
});                                                                                                         // 1308
                                                                                                            // 1309
var calculateVersion = function (clientSupportedVersions,                                                   // 1310
                                 serverSupportedVersions) {                                                 // 1311
  var correctVersion = _.find(clientSupportedVersions, function (version) {                                 // 1312
    return _.contains(serverSupportedVersions, version);                                                    // 1313
  });                                                                                                       // 1314
  if (!correctVersion) {                                                                                    // 1315
    correctVersion = serverSupportedVersions[0];                                                            // 1316
  }                                                                                                         // 1317
  return correctVersion;                                                                                    // 1318
};                                                                                                          // 1319
                                                                                                            // 1320
LivedataTest.calculateVersion = calculateVersion;                                                           // 1321
                                                                                                            // 1322
                                                                                                            // 1323
// "blind" exceptions other than those that were deliberately thrown to signal                              // 1324
// errors to the client                                                                                     // 1325
var wrapInternalException = function (exception, context) {                                                 // 1326
  if (!exception || exception instanceof Meteor.Error)                                                      // 1327
    return exception;                                                                                       // 1328
                                                                                                            // 1329
  // Did the error contain more details that could have been useful if caught in                            // 1330
  // server code (or if thrown from non-client-originated code), but also                                   // 1331
  // provided a "sanitized" version with more context than 500 Internal server                              // 1332
  // error? Use that.                                                                                       // 1333
  if (exception.sanitizedError) {                                                                           // 1334
    if (exception.sanitizedError instanceof Meteor.Error)                                                   // 1335
      return exception.sanitizedError;                                                                      // 1336
    Meteor._debug("Exception " + context + " provides a sanitizedError that " +                             // 1337
                  "is not a Meteor.Error; ignoring");                                                       // 1338
  }                                                                                                         // 1339
                                                                                                            // 1340
  // tests can set the 'expected' flag on an exception so it won't go to the                                // 1341
  // server log                                                                                             // 1342
  if (!exception.expected)                                                                                  // 1343
    Meteor._debug("Exception " + context, exception.stack);                                                 // 1344
                                                                                                            // 1345
  return new Meteor.Error(500, "Internal server error");                                                    // 1346
};                                                                                                          // 1347
                                                                                                            // 1348
                                                                                                            // 1349
// Audit argument checks, if the audit-argument-checks package exists (it is a                              // 1350
// weak dependency of this package).                                                                        // 1351
var maybeAuditArgumentChecks = function (f, context, args, description) {                                   // 1352
  args = args || [];                                                                                        // 1353
  if (Package['audit-argument-checks']) {                                                                   // 1354
    return Match._failIfArgumentsAreNotAllChecked(                                                          // 1355
      f, context, args, description);                                                                       // 1356
  }                                                                                                         // 1357
  return f.apply(context, args);                                                                            // 1358
};                                                                                                          // 1359
                                                                                                            // 1360
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/writefence.js                                                                          //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
var path = Npm.require('path');                                                                             // 1
var Future = Npm.require(path.join('fibers', 'future'));                                                    // 2
                                                                                                            // 3
// A write fence collects a group of writes, and provides a callback                                        // 4
// when all of the writes are fully committed and propagated (all                                           // 5
// observers have been notified of the write and acknowledged it.)                                          // 6
//                                                                                                          // 7
DDPServer._WriteFence = function () {                                                                       // 8
  var self = this;                                                                                          // 9
                                                                                                            // 10
  self.armed = false;                                                                                       // 11
  self.fired = false;                                                                                       // 12
  self.retired = false;                                                                                     // 13
  self.outstanding_writes = 0;                                                                              // 14
  self.completion_callbacks = [];                                                                           // 15
};                                                                                                          // 16
                                                                                                            // 17
// The current write fence. When there is a current write fence, code                                       // 18
// that writes to databases should register their writes with it using                                      // 19
// beginWrite().                                                                                            // 20
//                                                                                                          // 21
DDPServer._CurrentWriteFence = new Meteor.EnvironmentVariable;                                              // 22
                                                                                                            // 23
_.extend(DDPServer._WriteFence.prototype, {                                                                 // 24
  // Start tracking a write, and return an object to represent it. The                                      // 25
  // object has a single method, committed(). This method should be                                         // 26
  // called when the write is fully committed and propagated. You can                                       // 27
  // continue to add writes to the WriteFence up until it is triggered                                      // 28
  // (calls its callbacks because all writes have committed.)                                               // 29
  beginWrite: function () {                                                                                 // 30
    var self = this;                                                                                        // 31
                                                                                                            // 32
    if (self.retired)                                                                                       // 33
      return { committed: function () {} };                                                                 // 34
                                                                                                            // 35
    if (self.fired)                                                                                         // 36
      throw new Error("fence has already activated -- too late to add writes");                             // 37
                                                                                                            // 38
    self.outstanding_writes++;                                                                              // 39
    var committed = false;                                                                                  // 40
    return {                                                                                                // 41
      committed: function () {                                                                              // 42
        if (committed)                                                                                      // 43
          throw new Error("committed called twice on the same write");                                      // 44
        committed = true;                                                                                   // 45
        self.outstanding_writes--;                                                                          // 46
        self._maybeFire();                                                                                  // 47
      }                                                                                                     // 48
    };                                                                                                      // 49
  },                                                                                                        // 50
                                                                                                            // 51
  // Arm the fence. Once the fence is armed, and there are no more                                          // 52
  // uncommitted writes, it will activate.                                                                  // 53
  arm: function () {                                                                                        // 54
    var self = this;                                                                                        // 55
    self.armed = true;                                                                                      // 56
    self._maybeFire();                                                                                      // 57
  },                                                                                                        // 58
                                                                                                            // 59
  // Register a function to be called when the fence fires.                                                 // 60
  onAllCommitted: function (func) {                                                                         // 61
    var self = this;                                                                                        // 62
    if (self.fired)                                                                                         // 63
      throw new Error("fence has already activated -- too late to " +                                       // 64
                      "add a callback");                                                                    // 65
    self.completion_callbacks.push(func);                                                                   // 66
  },                                                                                                        // 67
                                                                                                            // 68
  // Convenience function. Arms the fence, then blocks until it fires.                                      // 69
  armAndWait: function () {                                                                                 // 70
    var self = this;                                                                                        // 71
    var future = new Future;                                                                                // 72
    self.onAllCommitted(function () {                                                                       // 73
      future['return']();                                                                                   // 74
    });                                                                                                     // 75
    self.arm();                                                                                             // 76
    future.wait();                                                                                          // 77
  },                                                                                                        // 78
                                                                                                            // 79
  _maybeFire: function () {                                                                                 // 80
    var self = this;                                                                                        // 81
    if (self.fired)                                                                                         // 82
      throw new Error("write fence already activated?");                                                    // 83
    if (self.armed && !self.outstanding_writes) {                                                           // 84
      self.fired = true;                                                                                    // 85
      _.each(self.completion_callbacks, function (f) {f(self);});                                           // 86
      self.completion_callbacks = [];                                                                       // 87
    }                                                                                                       // 88
  },                                                                                                        // 89
                                                                                                            // 90
  // Deactivate this fence so that adding more writes has no effect.                                        // 91
  // The fence must have already fired.                                                                     // 92
  retire: function () {                                                                                     // 93
    var self = this;                                                                                        // 94
    if (! self.fired)                                                                                       // 95
      throw new Error("Can't retire a fence that hasn't fired.");                                           // 96
    self.retired = true;                                                                                    // 97
  }                                                                                                         // 98
});                                                                                                         // 99
                                                                                                            // 100
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/crossbar.js                                                                            //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
DDPServer._InvalidationCrossbar = function () {                                                             // 1
  var self = this;                                                                                          // 2
                                                                                                            // 3
  self.next_id = 1;                                                                                         // 4
  // map from listener id to object. each object has keys 'trigger',                                        // 5
  // 'callback'.                                                                                            // 6
  self.listeners = {};                                                                                      // 7
};                                                                                                          // 8
                                                                                                            // 9
_.extend(DDPServer._InvalidationCrossbar.prototype, {                                                       // 10
  // Listen for notification that match 'trigger'. A notification                                           // 11
  // matches if it has the key-value pairs in trigger as a                                                  // 12
  // subset. When a notification matches, call 'callback', passing two                                      // 13
  // arguments, the actual notification and an acknowledgement                                              // 14
  // function. The callback should call the acknowledgement function                                        // 15
  // when it is finished processing the notification.                                                       // 16
  //                                                                                                        // 17
  // Returns a listen handle, which is an object with a method                                              // 18
  // stop(). Call stop() to stop listening.                                                                 // 19
  //                                                                                                        // 20
  // XXX It should be legal to call fire() from inside a listen()                                           // 21
  // callback?                                                                                              // 22
  //                                                                                                        // 23
  // Note: the LiveResultsSet constructor assumes that a call to listen() never                             // 24
  // yields.                                                                                                // 25
  listen: function (trigger, callback) {                                                                    // 26
    var self = this;                                                                                        // 27
    var id = self.next_id++;                                                                                // 28
    self.listeners[id] = {trigger: EJSON.clone(trigger), callback: callback};                               // 29
    return {                                                                                                // 30
      stop: function () {                                                                                   // 31
        delete self.listeners[id];                                                                          // 32
      }                                                                                                     // 33
    };                                                                                                      // 34
  },                                                                                                        // 35
                                                                                                            // 36
  // Fire the provided 'notification' (an object whose attribute                                            // 37
  // values are all JSON-compatibile) -- inform all matching listeners                                      // 38
  // (registered with listen()), and once they have all acknowledged                                        // 39
  // the notification, call onComplete with no arguments.                                                   // 40
  //                                                                                                        // 41
  // If fire() is called inside a write fence, then each of the                                             // 42
  // listener callbacks will be called inside the write fence as well.                                      // 43
  //                                                                                                        // 44
  // The listeners may be invoked in parallel, rather than serially.                                        // 45
  fire: function (notification, onComplete) {                                                               // 46
    var self = this;                                                                                        // 47
    var callbacks = [];                                                                                     // 48
    _.each(self.listeners, function (l) {                                                                   // 49
      if (self._matches(notification, l.trigger))                                                           // 50
        callbacks.push(l.callback);                                                                         // 51
    });                                                                                                     // 52
                                                                                                            // 53
    if (onComplete)                                                                                         // 54
      onComplete = Meteor.bindEnvironment(onComplete, function (e) {                                        // 55
        Meteor._debug("Exception in InvalidationCrossbar fire complete " +                                  // 56
                      "callback", e.stack);                                                                 // 57
      });                                                                                                   // 58
                                                                                                            // 59
    var outstanding = callbacks.length;                                                                     // 60
    if (!outstanding)                                                                                       // 61
      onComplete && onComplete();                                                                           // 62
    else {                                                                                                  // 63
      _.each(callbacks, function (c) {                                                                      // 64
        c(notification, function () {                                                                       // 65
          if (--outstanding === 0)                                                                          // 66
            onComplete && onComplete();                                                                     // 67
        });                                                                                                 // 68
      });                                                                                                   // 69
    }                                                                                                       // 70
  },                                                                                                        // 71
                                                                                                            // 72
  // A notification matches a trigger if all keys that exist in both are equal.                             // 73
  //                                                                                                        // 74
  // Examples:                                                                                              // 75
  //  N:{collection: "C"} matches T:{collection: "C"}                                                       // 76
  //    (a non-targeted write to a collection matches a                                                     // 77
  //     non-targeted query)                                                                                // 78
  //  N:{collection: "C", id: "X"} matches T:{collection: "C"}                                              // 79
  //    (a targeted write to a collection matches a non-targeted query)                                     // 80
  //  N:{collection: "C"} matches T:{collection: "C", id: "X"}                                              // 81
  //    (a non-targeted write to a collection matches a                                                     // 82
  //     targeted query)                                                                                    // 83
  //  N:{collection: "C", id: "X"} matches T:{collection: "C", id: "X"}                                     // 84
  //    (a targeted write to a collection matches a targeted query targeted                                 // 85
  //     at the same document)                                                                              // 86
  //  N:{collection: "C", id: "X"} does not match T:{collection: "C", id: "Y"}                              // 87
  //    (a targeted write to a collection does not match a targeted query                                   // 88
  //     targeted at a different document)                                                                  // 89
  _matches: function (notification, trigger) {                                                              // 90
    return _.all(trigger, function (triggerValue, key) {                                                    // 91
      return !_.has(notification, key) ||                                                                   // 92
        EJSON.equals(triggerValue, notification[key]);                                                      // 93
    });                                                                                                     // 94
  }                                                                                                         // 95
});                                                                                                         // 96
                                                                                                            // 97
// singleton                                                                                                // 98
DDPServer._InvalidationCrossbar = new DDPServer._InvalidationCrossbar;                                      // 99
                                                                                                            // 100
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/livedata_common.js                                                                     //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
DDP = {};                                                                                                   // 1
                                                                                                            // 2
SUPPORTED_DDP_VERSIONS = [ 'pre1' ];                                                                        // 3
                                                                                                            // 4
LivedataTest.SUPPORTED_DDP_VERSIONS = SUPPORTED_DDP_VERSIONS;                                               // 5
                                                                                                            // 6
MethodInvocation = function (options) {                                                                     // 7
  var self = this;                                                                                          // 8
                                                                                                            // 9
  // true if we're running not the actual method, but a stub (that is,                                      // 10
  // if we're on a client (which may be a browser, or in the future a                                       // 11
  // server connecting to another server) and presently running a                                           // 12
  // simulation of a server-side method for latency compensation                                            // 13
  // purposes). not currently true except in a client such as a browser,                                    // 14
  // since there's usually no point in running stubs unless you have a                                      // 15
  // zero-latency connection to the user.                                                                   // 16
  this.isSimulation = options.isSimulation;                                                                 // 17
                                                                                                            // 18
  // call this function to allow other method invocations (from the                                         // 19
  // same client) to continue running without waiting for this one to                                       // 20
  // complete.                                                                                              // 21
  this._unblock = options.unblock || function () {};                                                        // 22
  this._calledUnblock = false;                                                                              // 23
                                                                                                            // 24
  // current user id                                                                                        // 25
  this.userId = options.userId;                                                                             // 26
                                                                                                            // 27
  // sets current user id in all appropriate server contexts and                                            // 28
  // reruns subscriptions                                                                                   // 29
  this._setUserId = options.setUserId || function () {};                                                    // 30
                                                                                                            // 31
  // Scratch data scoped to this connection (livedata_connection on the                                     // 32
  // client, livedata_session on the server). This is only used                                             // 33
  // internally, but we should have real and documented API for this                                        // 34
  // sort of thing someday.                                                                                 // 35
  this._sessionData = options.sessionData;                                                                  // 36
};                                                                                                          // 37
                                                                                                            // 38
_.extend(MethodInvocation.prototype, {                                                                      // 39
  unblock: function () {                                                                                    // 40
    var self = this;                                                                                        // 41
    self._calledUnblock = true;                                                                             // 42
    self._unblock();                                                                                        // 43
  },                                                                                                        // 44
  setUserId: function(userId) {                                                                             // 45
    var self = this;                                                                                        // 46
    if (self._calledUnblock)                                                                                // 47
      throw new Error("Can't call setUserId in a method after calling unblock");                            // 48
    self.userId = userId;                                                                                   // 49
    self._setUserId(userId);                                                                                // 50
  }                                                                                                         // 51
});                                                                                                         // 52
                                                                                                            // 53
parseDDP = function (stringMessage) {                                                                       // 54
  try {                                                                                                     // 55
    var msg = JSON.parse(stringMessage);                                                                    // 56
  } catch (e) {                                                                                             // 57
    Meteor._debug("Discarding message with invalid JSON", stringMessage);                                   // 58
    return null;                                                                                            // 59
  }                                                                                                         // 60
  // DDP messages must be objects.                                                                          // 61
  if (msg === null || typeof msg !== 'object') {                                                            // 62
    Meteor._debug("Discarding non-object DDP message", stringMessage);                                      // 63
    return null;                                                                                            // 64
  }                                                                                                         // 65
                                                                                                            // 66
  // massage msg to get it into "abstract ddp" rather than "wire ddp" format.                               // 67
                                                                                                            // 68
  // switch between "cleared" rep of unsetting fields and "undefined"                                       // 69
  // rep of same                                                                                            // 70
  if (_.has(msg, 'cleared')) {                                                                              // 71
    if (!_.has(msg, 'fields'))                                                                              // 72
      msg.fields = {};                                                                                      // 73
    _.each(msg.cleared, function (clearKey) {                                                               // 74
      msg.fields[clearKey] = undefined;                                                                     // 75
    });                                                                                                     // 76
    delete msg.cleared;                                                                                     // 77
  }                                                                                                         // 78
                                                                                                            // 79
  _.each(['fields', 'params', 'result'], function (field) {                                                 // 80
    if (_.has(msg, field))                                                                                  // 81
      msg[field] = EJSON._adjustTypesFromJSONValue(msg[field]);                                             // 82
  });                                                                                                       // 83
                                                                                                            // 84
  return msg;                                                                                               // 85
};                                                                                                          // 86
                                                                                                            // 87
stringifyDDP = function (msg) {                                                                             // 88
  var copy = EJSON.clone(msg);                                                                              // 89
  // swizzle 'changed' messages from 'fields undefined' rep to 'fields                                      // 90
  // and cleared' rep                                                                                       // 91
  if (_.has(msg, 'fields')) {                                                                               // 92
    var cleared = [];                                                                                       // 93
    _.each(msg.fields, function (value, key) {                                                              // 94
      if (value === undefined) {                                                                            // 95
        cleared.push(key);                                                                                  // 96
        delete copy.fields[key];                                                                            // 97
      }                                                                                                     // 98
    });                                                                                                     // 99
    if (!_.isEmpty(cleared))                                                                                // 100
      copy.cleared = cleared;                                                                               // 101
    if (_.isEmpty(copy.fields))                                                                             // 102
      delete copy.fields;                                                                                   // 103
  }                                                                                                         // 104
  // adjust types to basic                                                                                  // 105
  _.each(['fields', 'params', 'result'], function (field) {                                                 // 106
    if (_.has(copy, field))                                                                                 // 107
      copy[field] = EJSON._adjustTypesToJSONValue(copy[field]);                                             // 108
  });                                                                                                       // 109
  if (msg.id && typeof msg.id !== 'string') {                                                               // 110
    throw new Error("Message id is not a string");                                                          // 111
  }                                                                                                         // 112
  return JSON.stringify(copy);                                                                              // 113
};                                                                                                          // 114
                                                                                                            // 115
// This is private but it's used in a few places. accounts-base uses                                        // 116
// it to get the current user. accounts-password uses it to stash SRP                                       // 117
// state in the DDP session. Meteor.setTimeout and friends clear                                            // 118
// it. We can probably find a better way to factor this.                                                    // 119
DDP._CurrentInvocation = new Meteor.EnvironmentVariable;                                                    // 120
                                                                                                            // 121
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/livedata_connection.js                                                                 //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
if (Meteor.isServer) {                                                                                      // 1
  var path = Npm.require('path');                                                                           // 2
  var Fiber = Npm.require('fibers');                                                                        // 3
  var Future = Npm.require(path.join('fibers', 'future'));                                                  // 4
}                                                                                                           // 5
                                                                                                            // 6
// @param url {String|Object} URL to Meteor app,                                                            // 7
//   or an object as a test hook (see code)                                                                 // 8
// Options:                                                                                                 // 9
//   reloadOnUpdate: should we try to reload when the server says                                           // 10
//                      there's new code available?                                                         // 11
//   reloadWithOutstanding: is it OK to reload if there are outstanding methods?                            // 12
var Connection = function (url, options) {                                                                  // 13
  var self = this;                                                                                          // 14
  options = _.extend({                                                                                      // 15
    reloadOnUpdate: false,                                                                                  // 16
    // The rest of these options are only for testing.                                                      // 17
    reloadWithOutstanding: false,                                                                           // 18
    supportedDDPVersions: SUPPORTED_DDP_VERSIONS,                                                           // 19
    onConnectionFailure: function (reason) {                                                                // 20
      Meteor._debug("Failed DDP connection: " + reason);                                                    // 21
    },                                                                                                      // 22
    onConnected: function () {}                                                                             // 23
  }, options);                                                                                              // 24
                                                                                                            // 25
  // If set, called when we reconnect, queuing method calls _before_ the                                    // 26
  // existing outstanding ones. This is the only data member that is part of the                            // 27
  // public API!                                                                                            // 28
  self.onReconnect = null;                                                                                  // 29
                                                                                                            // 30
  // as a test hook, allow passing a stream instead of a url.                                               // 31
  if (typeof url === "object") {                                                                            // 32
    self._stream = url;                                                                                     // 33
  } else {                                                                                                  // 34
    self._stream = new LivedataTest.ClientStream(url);                                                      // 35
  }                                                                                                         // 36
                                                                                                            // 37
  self._lastSessionId = null;                                                                               // 38
  self._versionSuggestion = null;  // The last proposed DDP version.                                        // 39
  self._version = null;   // The DDP version agreed on by client and server.                                // 40
  self._stores = {}; // name -> object with methods                                                         // 41
  self._methodHandlers = {}; // name -> func                                                                // 42
  self._nextMethodId = 1;                                                                                   // 43
  self._supportedDDPVersions = options.supportedDDPVersions;                                                // 44
                                                                                                            // 45
  // Tracks methods which the user has tried to call but which have not yet                                 // 46
  // called their user callback (ie, they are waiting on their result or for all                            // 47
  // of their writes to be written to the local cache). Map from method ID to                               // 48
  // MethodInvoker object.                                                                                  // 49
  self._methodInvokers = {};                                                                                // 50
                                                                                                            // 51
  // Tracks methods which the user has called but whose result messages have not                            // 52
  // arrived yet.                                                                                           // 53
  //                                                                                                        // 54
  // _outstandingMethodBlocks is an array of blocks of methods. Each block                                  // 55
  // represents a set of methods that can run at the same time. The first block                             // 56
  // represents the methods which are currently in flight; subsequent blocks                                // 57
  // must wait for previous blocks to be fully finished before they can be sent                             // 58
  // to the server.                                                                                         // 59
  //                                                                                                        // 60
  // Each block is an object with the following fields:                                                     // 61
  // - methods: a list of MethodInvoker objects                                                             // 62
  // - wait: a boolean; if true, this block had a single method invoked with                                // 63
  //         the "wait" option                                                                              // 64
  //                                                                                                        // 65
  // There will never be adjacent blocks with wait=false, because the only thing                            // 66
  // that makes methods need to be serialized is a wait method.                                             // 67
  //                                                                                                        // 68
  // Methods are removed from the first block when their "result" is                                        // 69
  // received. The entire first block is only removed when all of the in-flight                             // 70
  // methods have received their results (so the "methods" list is empty) *AND*                             // 71
  // all of the data written by those methods are visible in the local cache. So                            // 72
  // it is possible for the first block's methods list to be empty, if we are                               // 73
  // still waiting for some objects to quiesce.                                                             // 74
  //                                                                                                        // 75
  // Example:                                                                                               // 76
  //  _outstandingMethodBlocks = [                                                                          // 77
  //    {wait: false, methods: []},                                                                         // 78
  //    {wait: true, methods: [<MethodInvoker for 'login'>]},                                               // 79
  //    {wait: false, methods: [<MethodInvoker for 'foo'>,                                                  // 80
  //                            <MethodInvoker for 'bar'>]}]                                                // 81
  // This means that there were some methods which were sent to the server and                              // 82
  // which have returned their results, but some of the data written by                                     // 83
  // the methods may not be visible in the local cache. Once all that data is                               // 84
  // visible, we will send a 'login' method. Once the login method has returned                             // 85
  // and all the data is visible (including re-running subs if userId changes),                             // 86
  // we will send the 'foo' and 'bar' methods in parallel.                                                  // 87
  self._outstandingMethodBlocks = [];                                                                       // 88
                                                                                                            // 89
  // method ID -> array of objects with keys 'collection' and 'id', listing                                 // 90
  // documents written by a given method's stub. keys are associated with                                   // 91
  // methods whose stub wrote at least one document, and whose data-done message                            // 92
  // has not yet been received.                                                                             // 93
  self._documentsWrittenByStub = {};                                                                        // 94
  // collection -> id -> "server document" object. A "server document" has:                                 // 95
  // - "document": the version of the document according the                                                // 96
  //   server (ie, the snapshot before a stub wrote it, amended by any changes                              // 97
  //   received from the server)                                                                            // 98
  //   It is undefined if we think the document does not exist                                              // 99
  // - "writtenByStubs": a set of method IDs whose stubs wrote to the document                              // 100
  //   whose "data done" messages have not yet been processed                                               // 101
  self._serverDocuments = {};                                                                               // 102
                                                                                                            // 103
  // Array of callbacks to be called after the next update of the local                                     // 104
  // cache. Used for:                                                                                       // 105
  //  - Calling methodInvoker.dataVisible and sub ready callbacks after                                     // 106
  //    the relevant data is flushed.                                                                       // 107
  //  - Invoking the callbacks of "half-finished" methods after reconnect                                   // 108
  //    quiescence. Specifically, methods whose result was received over the old                            // 109
  //    connection (so we don't re-send it) but whose data had not been made                                // 110
  //    visible.                                                                                            // 111
  self._afterUpdateCallbacks = [];                                                                          // 112
                                                                                                            // 113
  // In two contexts, we buffer all incoming data messages and then process them                            // 114
  // all at once in a single update:                                                                        // 115
  //   - During reconnect, we buffer all data messages until all subs that had                              // 116
  //     been ready before reconnect are ready again, and all methods that are                              // 117
  //     active have returned their "data done message"; then                                               // 118
  //   - During the execution of a "wait" method, we buffer all data messages                               // 119
  //     until the wait method gets its "data done" message. (If the wait method                            // 120
  //     occurs during reconnect, it doesn't get any special handling.)                                     // 121
  // all data messages are processed in one update.                                                         // 122
  //                                                                                                        // 123
  // The following fields are used for this "quiescence" process.                                           // 124
                                                                                                            // 125
  // This buffers the messages that aren't being processed yet.                                             // 126
  self._messagesBufferedUntilQuiescence = [];                                                               // 127
  // Map from method ID -> true. Methods are removed from this when their                                   // 128
  // "data done" message is received, and we will not quiesce until it is                                   // 129
  // empty.                                                                                                 // 130
  self._methodsBlockingQuiescence = {};                                                                     // 131
  // map from sub ID -> true for subs that were ready (ie, called the sub                                   // 132
  // ready callback) before reconnect but haven't become ready again yet                                    // 133
  self._subsBeingRevived = {}; // map from sub._id -> true                                                  // 134
  // if true, the next data update should reset all stores. (set during                                     // 135
  // reconnect.)                                                                                            // 136
  self._resetStores = false;                                                                                // 137
                                                                                                            // 138
  // name -> array of updates for (yet to be created) collections                                           // 139
  self._updatesForUnknownStores = {};                                                                       // 140
  // if we're blocking a migration, the retry func                                                          // 141
  self._retryMigrate = null;                                                                                // 142
                                                                                                            // 143
  // metadata for subscriptions.  Map from sub ID to object with keys:                                      // 144
  //   - id                                                                                                 // 145
  //   - name                                                                                               // 146
  //   - params                                                                                             // 147
  //   - inactive (if true, will be cleaned up if not reused in re-run)                                     // 148
  //   - ready (has the 'ready' message been received?)                                                     // 149
  //   - readyCallback (an optional callback to call when ready)                                            // 150
  //   - errorCallback (an optional callback to call if the sub terminates with                             // 151
  //                    an error)                                                                           // 152
  self._subscriptions = {};                                                                                 // 153
                                                                                                            // 154
  // Per-connection scratch area. This is only used internally, but we                                      // 155
  // should have real and documented API for this sort of thing someday.                                    // 156
  self._sessionData = {};                                                                                   // 157
                                                                                                            // 158
  // Reactive userId.                                                                                       // 159
  self._userId = null;                                                                                      // 160
  self._userIdDeps = (typeof Deps !== "undefined") && new Deps.Dependency;                                  // 161
                                                                                                            // 162
  // Block auto-reload while we're waiting for method responses.                                            // 163
  if (Meteor.isClient && Package.reload && !options.reloadWithOutstanding) {                                // 164
    Reload._onMigrate(function (retry) {                                                                    // 165
      if (!self._readyToMigrate()) {                                                                        // 166
        if (self._retryMigrate)                                                                             // 167
          throw new Error("Two migrations in progress?");                                                   // 168
        self._retryMigrate = retry;                                                                         // 169
        return false;                                                                                       // 170
      } else {                                                                                              // 171
        return [true];                                                                                      // 172
      }                                                                                                     // 173
    });                                                                                                     // 174
  }                                                                                                         // 175
                                                                                                            // 176
  var onMessage = function (raw_msg) {                                                                      // 177
    try {                                                                                                   // 178
      var msg = parseDDP(raw_msg);                                                                          // 179
    } catch (e) {                                                                                           // 180
      Meteor._debug("Exception while parsing DDP", e);                                                      // 181
      return;                                                                                               // 182
    }                                                                                                       // 183
                                                                                                            // 184
    if (msg === null || !msg.msg) {                                                                         // 185
      Meteor._debug("discarding invalid livedata message", msg);                                            // 186
      return;                                                                                               // 187
    }                                                                                                       // 188
                                                                                                            // 189
    if (msg.msg === 'connected') {                                                                          // 190
      self._version = self._versionSuggestion;                                                              // 191
      options.onConnected();                                                                                // 192
      self._livedata_connected(msg);                                                                        // 193
    }                                                                                                       // 194
    else if (msg.msg == 'failed') {                                                                         // 195
      if (_.contains(self._supportedDDPVersions, msg.version)) {                                            // 196
        self._versionSuggestion = msg.version;                                                              // 197
        self._stream.reconnect({_force: true});                                                             // 198
      } else {                                                                                              // 199
        var error =                                                                                         // 200
              "Version negotiation failed; server requested version " + msg.version;                        // 201
        self._stream.disconnect({_permanent: true, _error: error});                                         // 202
        options.onConnectionFailure(error);                                                                 // 203
      }                                                                                                     // 204
    }                                                                                                       // 205
    else if (_.include(['added', 'changed', 'removed', 'ready', 'updated'], msg.msg))                       // 206
      self._livedata_data(msg);                                                                             // 207
    else if (msg.msg === 'nosub')                                                                           // 208
      self._livedata_nosub(msg);                                                                            // 209
    else if (msg.msg === 'result')                                                                          // 210
      self._livedata_result(msg);                                                                           // 211
    else if (msg.msg === 'error')                                                                           // 212
      self._livedata_error(msg);                                                                            // 213
    else                                                                                                    // 214
      Meteor._debug("discarding unknown livedata message type", msg);                                       // 215
  };                                                                                                        // 216
                                                                                                            // 217
  var onReset = function () {                                                                               // 218
    // Send a connect message at the beginning of the stream.                                               // 219
    // NOTE: reset is called even on the first connection, so this is                                       // 220
    // the only place we send this message.                                                                 // 221
    var msg = {msg: 'connect'};                                                                             // 222
    if (self._lastSessionId)                                                                                // 223
      msg.session = self._lastSessionId;                                                                    // 224
    msg.version = self._versionSuggestion || self._supportedDDPVersions[0];                                 // 225
    self._versionSuggestion = msg.version;                                                                  // 226
    msg.support = self._supportedDDPVersions;                                                               // 227
    self._send(msg);                                                                                        // 228
                                                                                                            // 229
    // Now, to minimize setup latency, go ahead and blast out all of                                        // 230
    // our pending methods ands subscriptions before we've even taken                                       // 231
    // the necessary RTT to know if we successfully reconnected. (1)                                        // 232
    // They're supposed to be idempotent; (2) even if we did                                                // 233
    // reconnect, we're not sure what messages might have gotten lost                                       // 234
    // (in either direction) since we were disconnected (TCP being                                          // 235
    // sloppy about that.)                                                                                  // 236
                                                                                                            // 237
    // If the current block of methods all got their results (but didn't all get                            // 238
    // their data visible), discard the empty block now.                                                    // 239
    if (! _.isEmpty(self._outstandingMethodBlocks) &&                                                       // 240
        _.isEmpty(self._outstandingMethodBlocks[0].methods)) {                                              // 241
      self._outstandingMethodBlocks.shift();                                                                // 242
    }                                                                                                       // 243
                                                                                                            // 244
    // Mark all messages as unsent, they have not yet been sent on this                                     // 245
    // connection.                                                                                          // 246
    _.each(self._methodInvokers, function (m) {                                                             // 247
      m.sentMessage = false;                                                                                // 248
    });                                                                                                     // 249
                                                                                                            // 250
    // If an `onReconnect` handler is set, call it first. Go through                                        // 251
    // some hoops to ensure that methods that are called from within                                        // 252
    // `onReconnect` get executed _before_ ones that were originally                                        // 253
    // outstanding (since `onReconnect` is used to re-establish auth                                        // 254
    // certificates)                                                                                        // 255
    if (self.onReconnect)                                                                                   // 256
      self._callOnReconnectAndSendAppropriateOutstandingMethods();                                          // 257
    else                                                                                                    // 258
      self._sendOutstandingMethods();                                                                       // 259
                                                                                                            // 260
    // add new subscriptions at the end. this way they take effect after                                    // 261
    // the handlers and we don't see flicker.                                                               // 262
    _.each(self._subscriptions, function (sub, id) {                                                        // 263
      self._send({                                                                                          // 264
        msg: 'sub',                                                                                         // 265
        id: id,                                                                                             // 266
        name: sub.name,                                                                                     // 267
        params: sub.params                                                                                  // 268
      });                                                                                                   // 269
    });                                                                                                     // 270
  };                                                                                                        // 271
                                                                                                            // 272
  if (Meteor.isServer) {                                                                                    // 273
    self._stream.on('message', Meteor.bindEnvironment(onMessage, Meteor._debug));                           // 274
    self._stream.on('reset', Meteor.bindEnvironment(onReset, Meteor._debug));                               // 275
  } else {                                                                                                  // 276
    self._stream.on('message', onMessage);                                                                  // 277
    self._stream.on('reset', onReset);                                                                      // 278
  }                                                                                                         // 279
                                                                                                            // 280
                                                                                                            // 281
  if (Meteor.isClient && Package.reload && options.reloadOnUpdate) {                                        // 282
    self._stream.on('update_available', function () {                                                       // 283
      // Start trying to migrate to a new version. Until all packages                                       // 284
      // signal that they're ready for a migration, the app will                                            // 285
      // continue running normally.                                                                         // 286
      Reload._reload();                                                                                     // 287
    });                                                                                                     // 288
  }                                                                                                         // 289
                                                                                                            // 290
};                                                                                                          // 291
                                                                                                            // 292
// A MethodInvoker manages sending a method to the server and calling the user's                            // 293
// callbacks. On construction, it registers itself in the connection's                                      // 294
// _methodInvokers map; it removes itself once the method is fully finished and                             // 295
// the callback is invoked. This occurs when it has both received a result,                                 // 296
// and the data written by it is fully visible.                                                             // 297
var MethodInvoker = function (options) {                                                                    // 298
  var self = this;                                                                                          // 299
                                                                                                            // 300
  // Public (within this file) fields.                                                                      // 301
  self.methodId = options.methodId;                                                                         // 302
  self.sentMessage = false;                                                                                 // 303
                                                                                                            // 304
  self._callback = options.callback;                                                                        // 305
  self._connection = options.connection;                                                                    // 306
  self._message = options.message;                                                                          // 307
  self._onResultReceived = options.onResultReceived || function () {};                                      // 308
  self._wait = options.wait;                                                                                // 309
  self._methodResult = null;                                                                                // 310
  self._dataVisible = false;                                                                                // 311
                                                                                                            // 312
  // Register with the connection.                                                                          // 313
  self._connection._methodInvokers[self.methodId] = self;                                                   // 314
};                                                                                                          // 315
_.extend(MethodInvoker.prototype, {                                                                         // 316
  // Sends the method message to the server. May be called additional times if                              // 317
  // we lose the connection and reconnect before receiving a result.                                        // 318
  sendMessage: function () {                                                                                // 319
    var self = this;                                                                                        // 320
    // This function is called before sending a method (including resending on                              // 321
    // reconnect). We should only (re)send methods where we don't already have a                            // 322
    // result!                                                                                              // 323
    if (self.gotResult())                                                                                   // 324
      throw new Error("sendingMethod is called on method with result");                                     // 325
                                                                                                            // 326
    // If we're re-sending it, it doesn't matter if data was written the first                              // 327
    // time.                                                                                                // 328
    self._dataVisible = false;                                                                              // 329
                                                                                                            // 330
    self.sentMessage = true;                                                                                // 331
                                                                                                            // 332
    // If this is a wait method, make all data messages be buffered until it is                             // 333
    // done.                                                                                                // 334
    if (self._wait)                                                                                         // 335
      self._connection._methodsBlockingQuiescence[self.methodId] = true;                                    // 336
                                                                                                            // 337
    // Actually send the message.                                                                           // 338
    self._connection._send(self._message);                                                                  // 339
  },                                                                                                        // 340
  // Invoke the callback, if we have both a result and know that all data has                               // 341
  // been written to the local cache.                                                                       // 342
  _maybeInvokeCallback: function () {                                                                       // 343
    var self = this;                                                                                        // 344
    if (self._methodResult && self._dataVisible) {                                                          // 345
      // Call the callback. (This won't throw: the callback was wrapped with                                // 346
      // bindEnvironment.)                                                                                  // 347
      self._callback(self._methodResult[0], self._methodResult[1]);                                         // 348
                                                                                                            // 349
      // Forget about this method.                                                                          // 350
      delete self._connection._methodInvokers[self.methodId];                                               // 351
                                                                                                            // 352
      // Let the connection know that this method is finished, so it can try to                             // 353
      // move on to the next block of methods.                                                              // 354
      self._connection._outstandingMethodFinished();                                                        // 355
    }                                                                                                       // 356
  },                                                                                                        // 357
  // Call with the result of the method from the server. Only may be called                                 // 358
  // once; once it is called, you should not call sendMessage again.                                        // 359
  // If the user provided an onResultReceived callback, call it immediately.                                // 360
  // Then invoke the main callback if data is also visible.                                                 // 361
  receiveResult: function (err, result) {                                                                   // 362
    var self = this;                                                                                        // 363
    if (self.gotResult())                                                                                   // 364
      throw new Error("Methods should only receive results once");                                          // 365
    self._methodResult = [err, result];                                                                     // 366
    self._onResultReceived(err, result);                                                                    // 367
    self._maybeInvokeCallback();                                                                            // 368
  },                                                                                                        // 369
  // Call this when all data written by the method is visible. This means that                              // 370
  // the method has returns its "data is done" message *AND* all server                                     // 371
  // documents that are buffered at that time have been written to the local                                // 372
  // cache. Invokes the main callback if the result has been received.                                      // 373
  dataVisible: function () {                                                                                // 374
    var self = this;                                                                                        // 375
    self._dataVisible = true;                                                                               // 376
    self._maybeInvokeCallback();                                                                            // 377
  },                                                                                                        // 378
  // True if receiveResult has been called.                                                                 // 379
  gotResult: function () {                                                                                  // 380
    var self = this;                                                                                        // 381
    return !!self._methodResult;                                                                            // 382
  }                                                                                                         // 383
});                                                                                                         // 384
                                                                                                            // 385
_.extend(Connection.prototype, {                                                                            // 386
  // 'name' is the name of the data on the wire that should go in the                                       // 387
  // store. 'wrappedStore' should be an object with methods beginUpdate, update,                            // 388
  // endUpdate, saveOriginals, retrieveOriginals. see Collection for an example.                            // 389
  registerStore: function (name, wrappedStore) {                                                            // 390
    var self = this;                                                                                        // 391
                                                                                                            // 392
    if (name in self._stores)                                                                               // 393
      return false;                                                                                         // 394
                                                                                                            // 395
    // Wrap the input object in an object which makes any store method not                                  // 396
    // implemented by 'store' into a no-op.                                                                 // 397
    var store = {};                                                                                         // 398
    _.each(['update', 'beginUpdate', 'endUpdate', 'saveOriginals',                                          // 399
            'retrieveOriginals'], function (method) {                                                       // 400
              store[method] = function () {                                                                 // 401
                return (wrappedStore[method]                                                                // 402
                        ? wrappedStore[method].apply(wrappedStore, arguments)                               // 403
                        : undefined);                                                                       // 404
              };                                                                                            // 405
            });                                                                                             // 406
                                                                                                            // 407
    self._stores[name] = store;                                                                             // 408
                                                                                                            // 409
    var queued = self._updatesForUnknownStores[name];                                                       // 410
    if (queued) {                                                                                           // 411
      store.beginUpdate(queued.length, false);                                                              // 412
      _.each(queued, function (msg) {                                                                       // 413
        store.update(msg);                                                                                  // 414
      });                                                                                                   // 415
      store.endUpdate();                                                                                    // 416
      delete self._updatesForUnknownStores[name];                                                           // 417
    }                                                                                                       // 418
                                                                                                            // 419
    return true;                                                                                            // 420
  },                                                                                                        // 421
                                                                                                            // 422
  subscribe: function (name /* .. [arguments] .. (callback|callbacks) */) {                                 // 423
    var self = this;                                                                                        // 424
                                                                                                            // 425
    var params = Array.prototype.slice.call(arguments, 1);                                                  // 426
    var callbacks = {};                                                                                     // 427
    if (params.length) {                                                                                    // 428
      var lastParam = params[params.length - 1];                                                            // 429
      if (typeof lastParam === "function") {                                                                // 430
        callbacks.onReady = params.pop();                                                                   // 431
      } else if (lastParam && (typeof lastParam.onReady === "function" ||                                   // 432
                               typeof lastParam.onError === "function")) {                                  // 433
        callbacks = params.pop();                                                                           // 434
      }                                                                                                     // 435
    }                                                                                                       // 436
                                                                                                            // 437
    // Is there an existing sub with the same name and param, run in an                                     // 438
    // invalidated Computation? This will happen if we are rerunning an                                     // 439
    // existing computation.                                                                                // 440
    //                                                                                                      // 441
    // For example, consider a rerun of:                                                                    // 442
    //                                                                                                      // 443
    //     Deps.autorun(function () {                                                                       // 444
    //       Meteor.subscribe("foo", Session.get("foo"));                                                   // 445
    //       Meteor.subscribe("bar", Session.get("bar"));                                                   // 446
    //     });                                                                                              // 447
    //                                                                                                      // 448
    // If "foo" has changed but "bar" has not, we will match the "bar"                                      // 449
    // subcribe to an existing inactive subscription in order to not                                        // 450
    // unsub and resub the subscription unnecessarily.                                                      // 451
    //                                                                                                      // 452
    // We only look for one such sub; if there are N apparently-identical subs                              // 453
    // being invalidated, we will require N matching subscribe calls to keep                                // 454
    // them all active.                                                                                     // 455
    var existing = _.find(self._subscriptions, function (sub) {                                             // 456
      return sub.inactive && sub.name === name &&                                                           // 457
        EJSON.equals(sub.params, params);                                                                   // 458
    });                                                                                                     // 459
                                                                                                            // 460
    var id;                                                                                                 // 461
    if (existing) {                                                                                         // 462
      id = existing.id;                                                                                     // 463
      existing.inactive = false; // reactivate                                                              // 464
                                                                                                            // 465
      if (callbacks.onReady) {                                                                              // 466
        // If the sub is not already ready, replace any ready callback with the                             // 467
        // one provided now. (It's not really clear what users would expect for                             // 468
        // an onReady callback inside an autorun; the semantics we provide is                               // 469
        // that at the time the sub first becomes ready, we call the last                                   // 470
        // onReady callback provided, if any.)                                                              // 471
        if (!existing.ready)                                                                                // 472
          existing.readyCallback = callbacks.onReady;                                                       // 473
      }                                                                                                     // 474
      if (callbacks.onError) {                                                                              // 475
        // Replace existing callback if any, so that errors aren't                                          // 476
        // double-reported.                                                                                 // 477
        existing.errorCallback = callbacks.onError;                                                         // 478
      }                                                                                                     // 479
    } else {                                                                                                // 480
      // New sub! Generate an id, save it locally, and send message.                                        // 481
      id = Random.id();                                                                                     // 482
      self._subscriptions[id] = {                                                                           // 483
        id: id,                                                                                             // 484
        name: name,                                                                                         // 485
        params: params,                                                                                     // 486
        inactive: false,                                                                                    // 487
        ready: false,                                                                                       // 488
        readyDeps: (typeof Deps !== "undefined") && new Deps.Dependency,                                    // 489
        readyCallback: callbacks.onReady,                                                                   // 490
        errorCallback: callbacks.onError                                                                    // 491
      };                                                                                                    // 492
      self._send({msg: 'sub', id: id, name: name, params: params});                                         // 493
    }                                                                                                       // 494
                                                                                                            // 495
    // return a handle to the application.                                                                  // 496
    var handle = {                                                                                          // 497
      stop: function () {                                                                                   // 498
        if (!_.has(self._subscriptions, id))                                                                // 499
          return;                                                                                           // 500
        self._send({msg: 'unsub', id: id});                                                                 // 501
        delete self._subscriptions[id];                                                                     // 502
      },                                                                                                    // 503
      ready: function () {                                                                                  // 504
        // return false if we've unsubscribed.                                                              // 505
        if (!_.has(self._subscriptions, id))                                                                // 506
          return false;                                                                                     // 507
        var record = self._subscriptions[id];                                                               // 508
        record.readyDeps && record.readyDeps.depend();                                                      // 509
        return record.ready;                                                                                // 510
      }                                                                                                     // 511
    };                                                                                                      // 512
                                                                                                            // 513
    if (Deps.active) {                                                                                      // 514
      // We're in a reactive computation, so we'd like to unsubscribe when the                              // 515
      // computation is invalidated... but not if the rerun just re-subscribes                              // 516
      // to the same subscription!  When a rerun happens, we use onInvalidate                               // 517
      // as a change to mark the subscription "inactive" so that it can                                     // 518
      // be reused from the rerun.  If it isn't reused, it's killed from                                    // 519
      // an afterFlush.                                                                                     // 520
      Deps.onInvalidate(function (c) {                                                                      // 521
        if (_.has(self._subscriptions, id))                                                                 // 522
          self._subscriptions[id].inactive = true;                                                          // 523
                                                                                                            // 524
        Deps.afterFlush(function () {                                                                       // 525
          if (_.has(self._subscriptions, id) &&                                                             // 526
              self._subscriptions[id].inactive)                                                             // 527
            handle.stop();                                                                                  // 528
        });                                                                                                 // 529
      });                                                                                                   // 530
    }                                                                                                       // 531
                                                                                                            // 532
    return handle;                                                                                          // 533
  },                                                                                                        // 534
                                                                                                            // 535
  // options:                                                                                               // 536
  // - onLateError {Function(error)} called if an error was received after the ready event.                 // 537
  //     (errors received before ready cause an error to be thrown)                                         // 538
  _subscribeAndWait: function (name, args, options) {                                                       // 539
    var self = this;                                                                                        // 540
    var f = new Future();                                                                                   // 541
    var ready = false;                                                                                      // 542
    args = args || [];                                                                                      // 543
    args.push({                                                                                             // 544
      onReady: function () {                                                                                // 545
        ready = true;                                                                                       // 546
        f['return']();                                                                                      // 547
      },                                                                                                    // 548
      onError: function (e) {                                                                               // 549
        if (!ready)                                                                                         // 550
          f['throw'](e);                                                                                    // 551
        else                                                                                                // 552
          options && options.onLateError && options.onLateError(e);                                         // 553
      }                                                                                                     // 554
    });                                                                                                     // 555
                                                                                                            // 556
    self.subscribe.apply(self, [name].concat(args));                                                        // 557
    f.wait();                                                                                               // 558
  },                                                                                                        // 559
                                                                                                            // 560
  methods: function (methods) {                                                                             // 561
    var self = this;                                                                                        // 562
    _.each(methods, function (func, name) {                                                                 // 563
      if (self._methodHandlers[name])                                                                       // 564
        throw new Error("A method named '" + name + "' is already defined");                                // 565
      self._methodHandlers[name] = func;                                                                    // 566
    });                                                                                                     // 567
  },                                                                                                        // 568
                                                                                                            // 569
  call: function (name /* .. [arguments] .. callback */) {                                                  // 570
    // if it's a function, the last argument is the result callback,                                        // 571
    // not a parameter to the remote method.                                                                // 572
    var args = Array.prototype.slice.call(arguments, 1);                                                    // 573
    if (args.length && typeof args[args.length - 1] === "function")                                         // 574
      var callback = args.pop();                                                                            // 575
    return this.apply(name, args, callback);                                                                // 576
  },                                                                                                        // 577
                                                                                                            // 578
  // @param options {Optional Object}                                                                       // 579
  //   wait: Boolean - Should we wait to call this until all current methods                                // 580
  //                   are fully finished, and block subsequent method calls                                // 581
  //                   until this method is fully finished?                                                 // 582
  //                   (does not affect methods called from within this method)                             // 583
  //   onResultReceived: Function - a callback to call as soon as the method                                // 584
  //                                result is received. the data written by                                 // 585
  //                                the method may not yet be in the cache!                                 // 586
  // @param callback {Optional Function}                                                                    // 587
  apply: function (name, args, options, callback) {                                                         // 588
    var self = this;                                                                                        // 589
                                                                                                            // 590
    // We were passed 3 arguments. They may be either (name, args, options)                                 // 591
    // or (name, args, callback)                                                                            // 592
    if (!callback && typeof options === 'function') {                                                       // 593
      callback = options;                                                                                   // 594
      options = {};                                                                                         // 595
    }                                                                                                       // 596
    options = options || {};                                                                                // 597
                                                                                                            // 598
    if (callback) {                                                                                         // 599
      // XXX would it be better form to do the binding in stream.on,                                        // 600
      // or caller, instead of here?                                                                        // 601
      callback = Meteor.bindEnvironment(callback, function (e) {                                            // 602
        // XXX improve error message (and how we report it)                                                 // 603
        Meteor._debug("Exception while delivering result of invoking '" +                                   // 604
                      name + "'", e, e.stack);                                                              // 605
      });                                                                                                   // 606
    }                                                                                                       // 607
                                                                                                            // 608
    // Lazily allocate method ID once we know that it'll be needed.                                         // 609
    var methodId = (function () {                                                                           // 610
      var id;                                                                                               // 611
      return function () {                                                                                  // 612
        if (id === undefined)                                                                               // 613
          id = '' + (self._nextMethodId++);                                                                 // 614
        return id;                                                                                          // 615
      };                                                                                                    // 616
    })();                                                                                                   // 617
                                                                                                            // 618
    // Run the stub, if we have one. The stub is supposed to make some                                      // 619
    // temporary writes to the database to give the user a smooth experience                                // 620
    // until the actual result of executing the method comes back from the                                  // 621
    // server (whereupon the temporary writes to the database will be reversed                              // 622
    // during the beginUpdate/endUpdate process.)                                                           // 623
    //                                                                                                      // 624
    // Normally, we ignore the return value of the stub (even if it is an                                   // 625
    // exception), in favor of the real return value from the server. The                                   // 626
    // exception is if the *caller* is a stub. In that case, we're not going                                // 627
    // to do a RPC, so we use the return value of the stub as our return                                    // 628
    // value.                                                                                               // 629
                                                                                                            // 630
    var enclosing = DDP._CurrentInvocation.get();                                                           // 631
    var alreadyInSimulation = enclosing && enclosing.isSimulation;                                          // 632
                                                                                                            // 633
    var stub = self._methodHandlers[name];                                                                  // 634
    if (stub) {                                                                                             // 635
      var setUserId = function(userId) {                                                                    // 636
        self.setUserId(userId);                                                                             // 637
      };                                                                                                    // 638
      var invocation = new MethodInvocation({                                                               // 639
        isSimulation: true,                                                                                 // 640
        userId: self.userId(), setUserId: setUserId,                                                        // 641
        sessionData: self._sessionData                                                                      // 642
      });                                                                                                   // 643
                                                                                                            // 644
      if (!alreadyInSimulation)                                                                             // 645
        self._saveOriginals();                                                                              // 646
                                                                                                            // 647
      try {                                                                                                 // 648
        // Note that unlike in the corresponding server code, we never audit                                // 649
        // that stubs check() their arguments.                                                              // 650
        var ret = DDP._CurrentInvocation.withValue(invocation, function () {                                // 651
          if (Meteor.isServer) {                                                                            // 652
            // Because saveOriginals and retrieveOriginals aren't reentrant,                                // 653
            // don't allow stubs to yield.                                                                  // 654
            return Meteor._noYieldsAllowed(function () {                                                    // 655
              return stub.apply(invocation, EJSON.clone(args));                                             // 656
            });                                                                                             // 657
          } else {                                                                                          // 658
            return stub.apply(invocation, EJSON.clone(args));                                               // 659
          }                                                                                                 // 660
        });                                                                                                 // 661
      }                                                                                                     // 662
      catch (e) {                                                                                           // 663
        var exception = e;                                                                                  // 664
      }                                                                                                     // 665
                                                                                                            // 666
      if (!alreadyInSimulation)                                                                             // 667
        self._retrieveAndStoreOriginals(methodId());                                                        // 668
    }                                                                                                       // 669
                                                                                                            // 670
    // If we're in a simulation, stop and return the result we have,                                        // 671
    // rather than going on to do an RPC. If there was no stub,                                             // 672
    // we'll end up returning undefined.                                                                    // 673
    if (alreadyInSimulation) {                                                                              // 674
      if (callback) {                                                                                       // 675
        callback(exception, ret);                                                                           // 676
        return undefined;                                                                                   // 677
      }                                                                                                     // 678
      if (exception)                                                                                        // 679
        throw exception;                                                                                    // 680
      return ret;                                                                                           // 681
    }                                                                                                       // 682
                                                                                                            // 683
    // If an exception occurred in a stub, and we're ignoring it                                            // 684
    // because we're doing an RPC and want to use what the server                                           // 685
    // returns instead, log it so the developer knows.                                                      // 686
    //                                                                                                      // 687
    // Tests can set the 'expected' flag on an exception so it won't                                        // 688
    // go to log.                                                                                           // 689
    if (exception && !exception.expected) {                                                                 // 690
      Meteor._debug("Exception while simulating the effect of invoking '" +                                 // 691
                    name + "'", exception, exception.stack);                                                // 692
    }                                                                                                       // 693
                                                                                                            // 694
                                                                                                            // 695
    // At this point we're definitely doing an RPC, and we're going to                                      // 696
    // return the value of the RPC to the caller.                                                           // 697
                                                                                                            // 698
    // If the caller didn't give a callback, decide what to do.                                             // 699
    if (!callback) {                                                                                        // 700
      if (Meteor.isClient) {                                                                                // 701
        // On the client, we don't have fibers, so we can't block. The                                      // 702
        // only thing we can do is to return undefined and discard the                                      // 703
        // result of the RPC.                                                                               // 704
        callback = function () {};                                                                          // 705
      } else {                                                                                              // 706
        // On the server, make the function synchronous. Throw on                                           // 707
        // errors, return on success.                                                                       // 708
        var future = new Future;                                                                            // 709
        callback = future.resolver();                                                                       // 710
      }                                                                                                     // 711
    }                                                                                                       // 712
    // Send the RPC. Note that on the client, it is important that the                                      // 713
    // stub have finished before we send the RPC, so that we know we have                                   // 714
    // a complete list of which local documents the stub wrote.                                             // 715
    var methodInvoker = new MethodInvoker({                                                                 // 716
      methodId: methodId(),                                                                                 // 717
      callback: callback,                                                                                   // 718
      connection: self,                                                                                     // 719
      onResultReceived: options.onResultReceived,                                                           // 720
      wait: !!options.wait,                                                                                 // 721
      message: {                                                                                            // 722
        msg: 'method',                                                                                      // 723
        method: name,                                                                                       // 724
        params: args,                                                                                       // 725
        id: methodId()                                                                                      // 726
      }                                                                                                     // 727
    });                                                                                                     // 728
                                                                                                            // 729
    if (options.wait) {                                                                                     // 730
      // It's a wait method! Wait methods go in their own block.                                            // 731
      self._outstandingMethodBlocks.push(                                                                   // 732
        {wait: true, methods: [methodInvoker]});                                                            // 733
    } else {                                                                                                // 734
      // Not a wait method. Start a new block if the previous block was a wait                              // 735
      // block, and add it to the last block of methods.                                                    // 736
      if (_.isEmpty(self._outstandingMethodBlocks) ||                                                       // 737
          _.last(self._outstandingMethodBlocks).wait)                                                       // 738
        self._outstandingMethodBlocks.push({wait: false, methods: []});                                     // 739
      _.last(self._outstandingMethodBlocks).methods.push(methodInvoker);                                    // 740
    }                                                                                                       // 741
                                                                                                            // 742
    // If we added it to the first block, send it out now.                                                  // 743
    if (self._outstandingMethodBlocks.length === 1)                                                         // 744
      methodInvoker.sendMessage();                                                                          // 745
                                                                                                            // 746
    // If we're using the default callback on the server,                                                   // 747
    // block waiting for the result.                                                                        // 748
    if (future) {                                                                                           // 749
      return future.wait();                                                                                 // 750
    }                                                                                                       // 751
    return undefined;                                                                                       // 752
  },                                                                                                        // 753
                                                                                                            // 754
  // Before calling a method stub, prepare all stores to track changes and allow                            // 755
  // _retrieveAndStoreOriginals to get the original versions of changed                                     // 756
  // documents.                                                                                             // 757
  _saveOriginals: function () {                                                                             // 758
    var self = this;                                                                                        // 759
    _.each(self._stores, function (s) {                                                                     // 760
      s.saveOriginals();                                                                                    // 761
    });                                                                                                     // 762
  },                                                                                                        // 763
  // Retrieves the original versions of all documents modified by the stub for                              // 764
  // method 'methodId' from all stores and saves them to _serverDocuments (keyed                            // 765
  // by document) and _documentsWrittenByStub (keyed by method ID).                                         // 766
  _retrieveAndStoreOriginals: function (methodId) {                                                         // 767
    var self = this;                                                                                        // 768
    if (self._documentsWrittenByStub[methodId])                                                             // 769
      throw new Error("Duplicate methodId in _retrieveAndStoreOriginals");                                  // 770
                                                                                                            // 771
    var docsWritten = [];                                                                                   // 772
    _.each(self._stores, function (s, collection) {                                                         // 773
      var originals = s.retrieveOriginals();                                                                // 774
      _.each(originals, function (doc, id) {                                                                // 775
        if (typeof id !== 'string')                                                                         // 776
          throw new Error("id is not a string");                                                            // 777
        docsWritten.push({collection: collection, id: id});                                                 // 778
        var serverDoc = Meteor._ensure(self._serverDocuments, collection, id);                              // 779
        if (serverDoc.writtenByStubs) {                                                                     // 780
          // We're not the first stub to write this doc. Just add our method ID                             // 781
          // to the record.                                                                                 // 782
          serverDoc.writtenByStubs[methodId] = true;                                                        // 783
        } else {                                                                                            // 784
          // First stub! Save the original value and our method ID.                                         // 785
          serverDoc.document = doc;                                                                         // 786
          serverDoc.flushCallbacks = [];                                                                    // 787
          serverDoc.writtenByStubs = {};                                                                    // 788
          serverDoc.writtenByStubs[methodId] = true;                                                        // 789
        }                                                                                                   // 790
      });                                                                                                   // 791
    });                                                                                                     // 792
    if (!_.isEmpty(docsWritten)) {                                                                          // 793
      self._documentsWrittenByStub[methodId] = docsWritten;                                                 // 794
    }                                                                                                       // 795
  },                                                                                                        // 796
                                                                                                            // 797
  // This is very much a private function we use to make the tests                                          // 798
  // take up fewer server resources after they complete.                                                    // 799
  _unsubscribeAll: function () {                                                                            // 800
    var self = this;                                                                                        // 801
    _.each(_.clone(self._subscriptions), function (sub, id) {                                               // 802
      self._send({msg: 'unsub', id: id});                                                                   // 803
      delete self._subscriptions[id];                                                                       // 804
    });                                                                                                     // 805
  },                                                                                                        // 806
                                                                                                            // 807
  // Sends the DDP stringification of the given message object                                              // 808
  _send: function (obj) {                                                                                   // 809
    var self = this;                                                                                        // 810
    self._stream.send(stringifyDDP(obj));                                                                   // 811
  },                                                                                                        // 812
                                                                                                            // 813
  status: function (/*passthrough args*/) {                                                                 // 814
    var self = this;                                                                                        // 815
    return self._stream.status.apply(self._stream, arguments);                                              // 816
  },                                                                                                        // 817
                                                                                                            // 818
  reconnect: function (/*passthrough args*/) {                                                              // 819
    var self = this;                                                                                        // 820
    return self._stream.reconnect.apply(self._stream, arguments);                                           // 821
  },                                                                                                        // 822
                                                                                                            // 823
  disconnect: function (/*passthrough args*/) {                                                             // 824
    var self = this;                                                                                        // 825
    return self._stream.disconnect.apply(self._stream, arguments);                                          // 826
  },                                                                                                        // 827
                                                                                                            // 828
  close: function () {                                                                                      // 829
    var self = this;                                                                                        // 830
    return self._stream.disconnect({_permanent: true});                                                     // 831
  },                                                                                                        // 832
                                                                                                            // 833
  ///                                                                                                       // 834
  /// Reactive user system                                                                                  // 835
  ///                                                                                                       // 836
  userId: function () {                                                                                     // 837
    var self = this;                                                                                        // 838
    if (self._userIdDeps)                                                                                   // 839
      self._userIdDeps.depend();                                                                            // 840
    return self._userId;                                                                                    // 841
  },                                                                                                        // 842
                                                                                                            // 843
  setUserId: function (userId) {                                                                            // 844
    var self = this;                                                                                        // 845
    // Avoid invalidating dependents if setUserId is called with current value.                             // 846
    if (self._userId === userId)                                                                            // 847
      return;                                                                                               // 848
    self._userId = userId;                                                                                  // 849
    if (self._userIdDeps)                                                                                   // 850
      self._userIdDeps.changed();                                                                           // 851
  },                                                                                                        // 852
                                                                                                            // 853
  // Returns true if we are in a state after reconnect of waiting for subs to be                            // 854
  // revived or early methods to finish their data, or we are waiting for a                                 // 855
  // "wait" method to finish.                                                                               // 856
  _waitingForQuiescence: function () {                                                                      // 857
    var self = this;                                                                                        // 858
    return (! _.isEmpty(self._subsBeingRevived) ||                                                          // 859
            ! _.isEmpty(self._methodsBlockingQuiescence));                                                  // 860
  },                                                                                                        // 861
                                                                                                            // 862
  // Returns true if any method whose message has been sent to the server has                               // 863
  // not yet invoked its user callback.                                                                     // 864
  _anyMethodsAreOutstanding: function () {                                                                  // 865
    var self = this;                                                                                        // 866
    return _.any(_.pluck(self._methodInvokers, 'sentMessage'));                                             // 867
  },                                                                                                        // 868
                                                                                                            // 869
  _livedata_connected: function (msg) {                                                                     // 870
    var self = this;                                                                                        // 871
                                                                                                            // 872
    // If this is a reconnect, we'll have to reset all stores.                                              // 873
    if (self._lastSessionId)                                                                                // 874
      self._resetStores = true;                                                                             // 875
                                                                                                            // 876
    if (typeof (msg.session) === "string") {                                                                // 877
      var reconnectedToPreviousSession = (self._lastSessionId === msg.session);                             // 878
      self._lastSessionId = msg.session;                                                                    // 879
    }                                                                                                       // 880
                                                                                                            // 881
    if (reconnectedToPreviousSession) {                                                                     // 882
      // Successful reconnection -- pick up where we left off.  Note that right                             // 883
      // now, this never happens: the server never connects us to a previous                                // 884
      // session, because DDP doesn't provide enough data for the server to know                            // 885
      // what messages the client has processed. We need to improve DDP to make                             // 886
      // this possible, at which point we'll probably need more code here.                                  // 887
      return;                                                                                               // 888
    }                                                                                                       // 889
                                                                                                            // 890
    // Server doesn't have our data any more. Re-sync a new session.                                        // 891
                                                                                                            // 892
    // Forget about messages we were buffering for unknown collections. They'll                             // 893
    // be resent if still relevant.                                                                         // 894
    self._updatesForUnknownStores = {};                                                                     // 895
                                                                                                            // 896
    if (self._resetStores) {                                                                                // 897
      // Forget about the effects of stubs. We'll be resetting all collections                              // 898
      // anyway.                                                                                            // 899
      self._documentsWrittenByStub = {};                                                                    // 900
      self._serverDocuments = {};                                                                           // 901
    }                                                                                                       // 902
                                                                                                            // 903
    // Clear _afterUpdateCallbacks.                                                                         // 904
    self._afterUpdateCallbacks = [];                                                                        // 905
                                                                                                            // 906
    // Mark all named subscriptions which are ready (ie, we already called the                              // 907
    // ready callback) as needing to be revived.                                                            // 908
    // XXX We should also block reconnect quiescence until unnamed subscriptions                            // 909
    //     (eg, autopublish) are done re-publishing to avoid flicker!                                       // 910
    self._subsBeingRevived = {};                                                                            // 911
    _.each(self._subscriptions, function (sub, id) {                                                        // 912
      if (sub.ready)                                                                                        // 913
        self._subsBeingRevived[id] = true;                                                                  // 914
    });                                                                                                     // 915
                                                                                                            // 916
    // Arrange for "half-finished" methods to have their callbacks run, and                                 // 917
    // track methods that were sent on this connection so that we don't                                     // 918
    // quiesce until they are all done.                                                                     // 919
    //                                                                                                      // 920
    // Start by clearing _methodsBlockingQuiescence: methods sent before                                    // 921
    // reconnect don't matter, and any "wait" methods sent on the new connection                            // 922
    // that we drop here will be restored by the loop below.                                                // 923
    self._methodsBlockingQuiescence = {};                                                                   // 924
    if (self._resetStores) {                                                                                // 925
      _.each(self._methodInvokers, function (invoker) {                                                     // 926
        if (invoker.gotResult()) {                                                                          // 927
          // This method already got its result, but it didn't call its callback                            // 928
          // because its data didn't become visible. We did not resend the                                  // 929
          // method RPC. We'll call its callback when we get a full quiesce,                                // 930
          // since that's as close as we'll get to "data must be visible".                                  // 931
          self._afterUpdateCallbacks.push(_.bind(invoker.dataVisible, invoker));                            // 932
        } else if (invoker.sentMessage) {                                                                   // 933
          // This method has been sent on this connection (maybe as a resend                                // 934
          // from the last connection, maybe from onReconnect, maybe just very                              // 935
          // quickly before processing the connected message).                                              // 936
          //                                                                                                // 937
          // We don't need to do anything special to ensure its callbacks get                               // 938
          // called, but we'll count it as a method which is preventing                                     // 939
          // reconnect quiescence. (eg, it might be a login method that was run                             // 940
          // from onReconnect, and we don't want to see flicker by seeing a                                 // 941
          // logged-out state.)                                                                             // 942
          self._methodsBlockingQuiescence[invoker.methodId] = true;                                         // 943
        }                                                                                                   // 944
      });                                                                                                   // 945
    }                                                                                                       // 946
                                                                                                            // 947
    self._messagesBufferedUntilQuiescence = [];                                                             // 948
                                                                                                            // 949
    // If we're not waiting on any methods or subs, we can reset the stores and                             // 950
    // call the callbacks immediately.                                                                      // 951
    if (!self._waitingForQuiescence()) {                                                                    // 952
      if (self._resetStores) {                                                                              // 953
        _.each(self._stores, function (s) {                                                                 // 954
          s.beginUpdate(0, true);                                                                           // 955
          s.endUpdate();                                                                                    // 956
        });                                                                                                 // 957
        self._resetStores = false;                                                                          // 958
      }                                                                                                     // 959
      self._runAfterUpdateCallbacks();                                                                      // 960
    }                                                                                                       // 961
  },                                                                                                        // 962
                                                                                                            // 963
                                                                                                            // 964
  _processOneDataMessage: function (msg, updates) {                                                         // 965
    var self = this;                                                                                        // 966
    // Using underscore here so as not to need to capitalize.                                               // 967
    self['_process_' + msg.msg](msg, updates);                                                              // 968
  },                                                                                                        // 969
                                                                                                            // 970
                                                                                                            // 971
  _livedata_data: function (msg) {                                                                          // 972
    var self = this;                                                                                        // 973
                                                                                                            // 974
    // collection name -> array of messages                                                                 // 975
    var updates = {};                                                                                       // 976
                                                                                                            // 977
    if (self._waitingForQuiescence()) {                                                                     // 978
      self._messagesBufferedUntilQuiescence.push(msg);                                                      // 979
                                                                                                            // 980
      if (msg.msg === "nosub")                                                                              // 981
        delete self._subsBeingRevived[msg.id];                                                              // 982
                                                                                                            // 983
      _.each(msg.subs || [], function (subId) {                                                             // 984
        delete self._subsBeingRevived[subId];                                                               // 985
      });                                                                                                   // 986
      _.each(msg.methods || [], function (methodId) {                                                       // 987
        delete self._methodsBlockingQuiescence[methodId];                                                   // 988
      });                                                                                                   // 989
                                                                                                            // 990
      if (self._waitingForQuiescence())                                                                     // 991
        return;                                                                                             // 992
                                                                                                            // 993
      // No methods or subs are blocking quiescence!                                                        // 994
      // We'll now process and all of our buffered messages, reset all stores,                              // 995
      // and apply them all at once.                                                                        // 996
      _.each(self._messagesBufferedUntilQuiescence, function (bufferedMsg) {                                // 997
        self._processOneDataMessage(bufferedMsg, updates);                                                  // 998
      });                                                                                                   // 999
      self._messagesBufferedUntilQuiescence = [];                                                           // 1000
    } else {                                                                                                // 1001
      self._processOneDataMessage(msg, updates);                                                            // 1002
    }                                                                                                       // 1003
                                                                                                            // 1004
    if (self._resetStores || !_.isEmpty(updates)) {                                                         // 1005
      // Begin a transactional update of each store.                                                        // 1006
      _.each(self._stores, function (s, storeName) {                                                        // 1007
        s.beginUpdate(_.has(updates, storeName) ? updates[storeName].length : 0,                            // 1008
                      self._resetStores);                                                                   // 1009
      });                                                                                                   // 1010
      self._resetStores = false;                                                                            // 1011
                                                                                                            // 1012
      _.each(updates, function (updateMessages, storeName) {                                                // 1013
        var store = self._stores[storeName];                                                                // 1014
        if (store) {                                                                                        // 1015
          _.each(updateMessages, function (updateMessage) {                                                 // 1016
            store.update(updateMessage);                                                                    // 1017
          });                                                                                               // 1018
        } else {                                                                                            // 1019
          // Nobody's listening for this data. Queue it up until                                            // 1020
          // someone wants it.                                                                              // 1021
          // XXX memory use will grow without bound if you forget to                                        // 1022
          // create a collection or just don't care about it... going                                       // 1023
          // to have to do something about that.                                                            // 1024
          if (!_.has(self._updatesForUnknownStores, storeName))                                             // 1025
            self._updatesForUnknownStores[storeName] = [];                                                  // 1026
          Array.prototype.push.apply(self._updatesForUnknownStores[storeName],                              // 1027
                                     updateMessages);                                                       // 1028
        }                                                                                                   // 1029
      });                                                                                                   // 1030
                                                                                                            // 1031
      // End update transaction.                                                                            // 1032
      _.each(self._stores, function (s) { s.endUpdate(); });                                                // 1033
    }                                                                                                       // 1034
                                                                                                            // 1035
    self._runAfterUpdateCallbacks();                                                                        // 1036
  },                                                                                                        // 1037
                                                                                                            // 1038
  // Call any callbacks deferred with _runWhenAllServerDocsAreFlushed whose                                 // 1039
  // relevant docs have been flushed, as well as dataVisible callbacks at                                   // 1040
  // reconnect-quiescence time.                                                                             // 1041
  _runAfterUpdateCallbacks: function () {                                                                   // 1042
    var self = this;                                                                                        // 1043
    var callbacks = self._afterUpdateCallbacks;                                                             // 1044
    self._afterUpdateCallbacks = [];                                                                        // 1045
    _.each(callbacks, function (c) {                                                                        // 1046
      c();                                                                                                  // 1047
    });                                                                                                     // 1048
  },                                                                                                        // 1049
                                                                                                            // 1050
  _pushUpdate: function (updates, collection, msg) {                                                        // 1051
    var self = this;                                                                                        // 1052
    if (!_.has(updates, collection)) {                                                                      // 1053
      updates[collection] = [];                                                                             // 1054
    }                                                                                                       // 1055
    updates[collection].push(msg);                                                                          // 1056
  },                                                                                                        // 1057
                                                                                                            // 1058
  _process_added: function (msg, updates) {                                                                 // 1059
    var self = this;                                                                                        // 1060
    var serverDoc = Meteor._get(self._serverDocuments, msg.collection, msg.id);                             // 1061
    if (serverDoc) {                                                                                        // 1062
      // Some outstanding stub wrote here.                                                                  // 1063
      if (serverDoc.document !== undefined) {                                                               // 1064
        throw new Error("It doesn't make sense to be adding something we know exists: "                     // 1065
                        + msg.id);                                                                          // 1066
      }                                                                                                     // 1067
      serverDoc.document = msg.fields || {};                                                                // 1068
      serverDoc.document._id = LocalCollection._idParse(msg.id);                                            // 1069
    } else {                                                                                                // 1070
      self._pushUpdate(updates, msg.collection, msg);                                                       // 1071
    }                                                                                                       // 1072
  },                                                                                                        // 1073
                                                                                                            // 1074
  _process_changed: function (msg, updates) {                                                               // 1075
    var self = this;                                                                                        // 1076
    var serverDoc = Meteor._get(self._serverDocuments, msg.collection, msg.id);                             // 1077
    if (serverDoc) {                                                                                        // 1078
      if (serverDoc.document === undefined) {                                                               // 1079
        throw new Error("It doesn't make sense to be changing something we don't think exists: "            // 1080
                        + msg.id);                                                                          // 1081
      }                                                                                                     // 1082
      LocalCollection._applyChanges(serverDoc.document, msg.fields);                                        // 1083
    } else {                                                                                                // 1084
      self._pushUpdate(updates, msg.collection, msg);                                                       // 1085
    }                                                                                                       // 1086
  },                                                                                                        // 1087
                                                                                                            // 1088
  _process_removed: function (msg, updates) {                                                               // 1089
    var self = this;                                                                                        // 1090
    var serverDoc = Meteor._get(                                                                            // 1091
      self._serverDocuments, msg.collection, msg.id);                                                       // 1092
    if (serverDoc) {                                                                                        // 1093
      // Some outstanding stub wrote here.                                                                  // 1094
      if (serverDoc.document === undefined) {                                                               // 1095
        throw new Error("It doesn't make sense to be deleting something we don't know exists: "             // 1096
                        + msg.id);                                                                          // 1097
      }                                                                                                     // 1098
      serverDoc.document = undefined;                                                                       // 1099
    } else {                                                                                                // 1100
      self._pushUpdate(updates, msg.collection, {                                                           // 1101
        msg: 'removed',                                                                                     // 1102
        collection: msg.collection,                                                                         // 1103
        id: msg.id                                                                                          // 1104
      });                                                                                                   // 1105
    }                                                                                                       // 1106
  },                                                                                                        // 1107
                                                                                                            // 1108
  _process_updated: function (msg, updates) {                                                               // 1109
    var self = this;                                                                                        // 1110
    // Process "method done" messages.                                                                      // 1111
    _.each(msg.methods, function (methodId) {                                                               // 1112
      _.each(self._documentsWrittenByStub[methodId], function (written) {                                   // 1113
        var serverDoc = Meteor._get(self._serverDocuments,                                                  // 1114
                                    written.collection, written.id);                                        // 1115
        if (!serverDoc)                                                                                     // 1116
          throw new Error("Lost serverDoc for " + JSON.stringify(written));                                 // 1117
        if (!serverDoc.writtenByStubs[methodId])                                                            // 1118
          throw new Error("Doc " + JSON.stringify(written) +                                                // 1119
                          " not written by  method " + methodId);                                           // 1120
        delete serverDoc.writtenByStubs[methodId];                                                          // 1121
        if (_.isEmpty(serverDoc.writtenByStubs)) {                                                          // 1122
          // All methods whose stubs wrote this method have completed! We can                               // 1123
          // now copy the saved document to the database (reverting the stub's                              // 1124
          // change if the server did not write to this object, or applying the                             // 1125
          // server's writes if it did).                                                                    // 1126
                                                                                                            // 1127
          // This is a fake ddp 'replace' message.  It's just for talking between                           // 1128
          // livedata connections and minimongo.                                                            // 1129
          self._pushUpdate(updates, written.collection, {                                                   // 1130
            msg: 'replace',                                                                                 // 1131
            id: written.id,                                                                                 // 1132
            replace: serverDoc.document                                                                     // 1133
          });                                                                                               // 1134
          // Call all flush callbacks.                                                                      // 1135
          _.each(serverDoc.flushCallbacks, function (c) {                                                   // 1136
            c();                                                                                            // 1137
          });                                                                                               // 1138
                                                                                                            // 1139
          // Delete this completed serverDocument. Don't bother to GC empty                                 // 1140
          // objects inside self._serverDocuments, since there probably aren't                              // 1141
          // many collections and they'll be written repeatedly.                                            // 1142
          delete self._serverDocuments[written.collection][written.id];                                     // 1143
        }                                                                                                   // 1144
      });                                                                                                   // 1145
      delete self._documentsWrittenByStub[methodId];                                                        // 1146
                                                                                                            // 1147
      // We want to call the data-written callback, but we can't do so until all                            // 1148
      // currently buffered messages are flushed.                                                           // 1149
      var callbackInvoker = self._methodInvokers[methodId];                                                 // 1150
      if (!callbackInvoker)                                                                                 // 1151
        throw new Error("No callback invoker for method " + methodId);                                      // 1152
      self._runWhenAllServerDocsAreFlushed(                                                                 // 1153
        _.bind(callbackInvoker.dataVisible, callbackInvoker));                                              // 1154
    });                                                                                                     // 1155
  },                                                                                                        // 1156
                                                                                                            // 1157
  _process_ready: function (msg, updates) {                                                                 // 1158
    var self = this;                                                                                        // 1159
    // Process "sub ready" messages. "sub ready" messages don't take effect                                 // 1160
    // until all current server documents have been flushed to the local                                    // 1161
    // database. We can use a write fence to implement this.                                                // 1162
    _.each(msg.subs, function (subId) {                                                                     // 1163
      self._runWhenAllServerDocsAreFlushed(function () {                                                    // 1164
        var subRecord = self._subscriptions[subId];                                                         // 1165
        // Did we already unsubscribe?                                                                      // 1166
        if (!subRecord)                                                                                     // 1167
          return;                                                                                           // 1168
        // Did we already receive a ready message? (Oops!)                                                  // 1169
        if (subRecord.ready)                                                                                // 1170
          return;                                                                                           // 1171
        subRecord.readyCallback && subRecord.readyCallback();                                               // 1172
        subRecord.ready = true;                                                                             // 1173
        subRecord.readyDeps && subRecord.readyDeps.changed();                                               // 1174
      });                                                                                                   // 1175
    });                                                                                                     // 1176
  },                                                                                                        // 1177
                                                                                                            // 1178
  // Ensures that "f" will be called after all documents currently in                                       // 1179
  // _serverDocuments have been written to the local cache. f will not be called                            // 1180
  // if the connection is lost before then!                                                                 // 1181
  _runWhenAllServerDocsAreFlushed: function (f) {                                                           // 1182
    var self = this;                                                                                        // 1183
    var runFAfterUpdates = function () {                                                                    // 1184
      self._afterUpdateCallbacks.push(f);                                                                   // 1185
    };                                                                                                      // 1186
    var unflushedServerDocCount = 0;                                                                        // 1187
    var onServerDocFlush = function () {                                                                    // 1188
      --unflushedServerDocCount;                                                                            // 1189
      if (unflushedServerDocCount === 0) {                                                                  // 1190
        // This was the last doc to flush! Arrange to run f after the updates                               // 1191
        // have been applied.                                                                               // 1192
        runFAfterUpdates();                                                                                 // 1193
      }                                                                                                     // 1194
    };                                                                                                      // 1195
    _.each(self._serverDocuments, function (collectionDocs) {                                               // 1196
      _.each(collectionDocs, function (serverDoc) {                                                         // 1197
        var writtenByStubForAMethodWithSentMessage = _.any(                                                 // 1198
          serverDoc.writtenByStubs, function (dummy, methodId) {                                            // 1199
            var invoker = self._methodInvokers[methodId];                                                   // 1200
            return invoker && invoker.sentMessage;                                                          // 1201
          });                                                                                               // 1202
        if (writtenByStubForAMethodWithSentMessage) {                                                       // 1203
          ++unflushedServerDocCount;                                                                        // 1204
          serverDoc.flushCallbacks.push(onServerDocFlush);                                                  // 1205
        }                                                                                                   // 1206
      });                                                                                                   // 1207
    });                                                                                                     // 1208
    if (unflushedServerDocCount === 0) {                                                                    // 1209
      // There aren't any buffered docs --- we can call f as soon as the current                            // 1210
      // round of updates is applied!                                                                       // 1211
      runFAfterUpdates();                                                                                   // 1212
    }                                                                                                       // 1213
  },                                                                                                        // 1214
                                                                                                            // 1215
  _livedata_nosub: function (msg) {                                                                         // 1216
    var self = this;                                                                                        // 1217
                                                                                                            // 1218
    // First pass it through _livedata_data, which only uses it to help get                                 // 1219
    // towards quiescence.                                                                                  // 1220
    self._livedata_data(msg);                                                                               // 1221
                                                                                                            // 1222
    // Do the rest of our processing immediately, with no                                                   // 1223
    // buffering-until-quiescence.                                                                          // 1224
                                                                                                            // 1225
    // we weren't subbed anyway, or we initiated the unsub.                                                 // 1226
    if (!_.has(self._subscriptions, msg.id))                                                                // 1227
      return;                                                                                               // 1228
    var errorCallback = self._subscriptions[msg.id].errorCallback;                                          // 1229
    delete self._subscriptions[msg.id];                                                                     // 1230
    if (errorCallback && msg.error) {                                                                       // 1231
      errorCallback(new Meteor.Error(                                                                       // 1232
        msg.error.error, msg.error.reason, msg.error.details));                                             // 1233
    }                                                                                                       // 1234
  },                                                                                                        // 1235
                                                                                                            // 1236
  _process_nosub: function () {                                                                             // 1237
    // This is called as part of the "buffer until quiescence" process, but                                 // 1238
    // nosub's effect is always immediate. It only goes in the buffer at all                                // 1239
    // because it's possible for a nosub to be the thing that triggers                                      // 1240
    // quiescence, if we were waiting for a sub to be revived and it dies                                   // 1241
    // instead.                                                                                             // 1242
  },                                                                                                        // 1243
                                                                                                            // 1244
  _livedata_result: function (msg) {                                                                        // 1245
    // id, result or error. error has error (code), reason, details                                         // 1246
                                                                                                            // 1247
    var self = this;                                                                                        // 1248
                                                                                                            // 1249
    // find the outstanding request                                                                         // 1250
    // should be O(1) in nearly all realistic use cases                                                     // 1251
    if (_.isEmpty(self._outstandingMethodBlocks)) {                                                         // 1252
      Meteor._debug("Received method result but no methods outstanding");                                   // 1253
      return;                                                                                               // 1254
    }                                                                                                       // 1255
    var currentMethodBlock = self._outstandingMethodBlocks[0].methods;                                      // 1256
    var m;                                                                                                  // 1257
    for (var i = 0; i < currentMethodBlock.length; i++) {                                                   // 1258
      m = currentMethodBlock[i];                                                                            // 1259
      if (m.methodId === msg.id)                                                                            // 1260
        break;                                                                                              // 1261
    }                                                                                                       // 1262
                                                                                                            // 1263
    if (!m) {                                                                                               // 1264
      Meteor._debug("Can't match method response to original method call", msg);                            // 1265
      return;                                                                                               // 1266
    }                                                                                                       // 1267
                                                                                                            // 1268
    // Remove from current method block. This may leave the block empty, but we                             // 1269
    // don't move on to the next block until the callback has been delivered, in                            // 1270
    // _outstandingMethodFinished.                                                                          // 1271
    currentMethodBlock.splice(i, 1);                                                                        // 1272
                                                                                                            // 1273
    if (_.has(msg, 'error')) {                                                                              // 1274
      m.receiveResult(new Meteor.Error(                                                                     // 1275
        msg.error.error, msg.error.reason,                                                                  // 1276
        msg.error.details));                                                                                // 1277
    } else {                                                                                                // 1278
      // msg.result may be undefined if the method didn't return a                                          // 1279
      // value                                                                                              // 1280
      m.receiveResult(undefined, msg.result);                                                               // 1281
    }                                                                                                       // 1282
  },                                                                                                        // 1283
                                                                                                            // 1284
  // Called by MethodInvoker after a method's callback is invoked.  If this was                             // 1285
  // the last outstanding method in the current block, runs the next block. If                              // 1286
  // there are no more methods, consider accepting a hot code push.                                         // 1287
  _outstandingMethodFinished: function () {                                                                 // 1288
    var self = this;                                                                                        // 1289
    if (self._anyMethodsAreOutstanding())                                                                   // 1290
      return;                                                                                               // 1291
                                                                                                            // 1292
    // No methods are outstanding. This should mean that the first block of                                 // 1293
    // methods is empty. (Or it might not exist, if this was a method that                                  // 1294
    // half-finished before disconnect/reconnect.)                                                          // 1295
    if (! _.isEmpty(self._outstandingMethodBlocks)) {                                                       // 1296
      var firstBlock = self._outstandingMethodBlocks.shift();                                               // 1297
      if (! _.isEmpty(firstBlock.methods))                                                                  // 1298
        throw new Error("No methods outstanding but nonempty block: " +                                     // 1299
                        JSON.stringify(firstBlock));                                                        // 1300
                                                                                                            // 1301
      // Send the outstanding methods now in the first block.                                               // 1302
      if (!_.isEmpty(self._outstandingMethodBlocks))                                                        // 1303
        self._sendOutstandingMethods();                                                                     // 1304
    }                                                                                                       // 1305
                                                                                                            // 1306
    // Maybe accept a hot code push.                                                                        // 1307
    self._maybeMigrate();                                                                                   // 1308
  },                                                                                                        // 1309
                                                                                                            // 1310
  // Sends messages for all the methods in the first block in                                               // 1311
  // _outstandingMethodBlocks.                                                                              // 1312
  _sendOutstandingMethods: function() {                                                                     // 1313
    var self = this;                                                                                        // 1314
    if (_.isEmpty(self._outstandingMethodBlocks))                                                           // 1315
      return;                                                                                               // 1316
    _.each(self._outstandingMethodBlocks[0].methods, function (m) {                                         // 1317
      m.sendMessage();                                                                                      // 1318
    });                                                                                                     // 1319
  },                                                                                                        // 1320
                                                                                                            // 1321
  _livedata_error: function (msg) {                                                                         // 1322
    Meteor._debug("Received error from server: ", msg.reason);                                              // 1323
    if (msg.offendingMessage)                                                                               // 1324
      Meteor._debug("For: ", msg.offendingMessage);                                                         // 1325
  },                                                                                                        // 1326
                                                                                                            // 1327
  _callOnReconnectAndSendAppropriateOutstandingMethods: function() {                                        // 1328
    var self = this;                                                                                        // 1329
    var oldOutstandingMethodBlocks = self._outstandingMethodBlocks;                                         // 1330
    self._outstandingMethodBlocks = [];                                                                     // 1331
                                                                                                            // 1332
    self.onReconnect();                                                                                     // 1333
                                                                                                            // 1334
    if (_.isEmpty(oldOutstandingMethodBlocks))                                                              // 1335
      return;                                                                                               // 1336
                                                                                                            // 1337
    // We have at least one block worth of old outstanding methods to try                                   // 1338
    // again. First: did onReconnect actually send anything? If not, we just                                // 1339
    // restore all outstanding methods and run the first block.                                             // 1340
    if (_.isEmpty(self._outstandingMethodBlocks)) {                                                         // 1341
      self._outstandingMethodBlocks = oldOutstandingMethodBlocks;                                           // 1342
      self._sendOutstandingMethods();                                                                       // 1343
      return;                                                                                               // 1344
    }                                                                                                       // 1345
                                                                                                            // 1346
    // OK, there are blocks on both sides. Special case: merge the last block of                            // 1347
    // the reconnect methods with the first block of the original methods, if                               // 1348
    // neither of them are "wait" blocks.                                                                   // 1349
    if (!_.last(self._outstandingMethodBlocks).wait &&                                                      // 1350
        !oldOutstandingMethodBlocks[0].wait) {                                                              // 1351
      _.each(oldOutstandingMethodBlocks[0].methods, function (m) {                                          // 1352
        _.last(self._outstandingMethodBlocks).methods.push(m);                                              // 1353
                                                                                                            // 1354
        // If this "last block" is also the first block, send the message.                                  // 1355
        if (self._outstandingMethodBlocks.length === 1)                                                     // 1356
          m.sendMessage();                                                                                  // 1357
      });                                                                                                   // 1358
                                                                                                            // 1359
      oldOutstandingMethodBlocks.shift();                                                                   // 1360
    }                                                                                                       // 1361
                                                                                                            // 1362
    // Now add the rest of the original blocks on.                                                          // 1363
    _.each(oldOutstandingMethodBlocks, function (block) {                                                   // 1364
      self._outstandingMethodBlocks.push(block);                                                            // 1365
    });                                                                                                     // 1366
  },                                                                                                        // 1367
                                                                                                            // 1368
  // We can accept a hot code push if there are no methods in flight.                                       // 1369
  _readyToMigrate: function() {                                                                             // 1370
    var self = this;                                                                                        // 1371
    return _.isEmpty(self._methodInvokers);                                                                 // 1372
  },                                                                                                        // 1373
                                                                                                            // 1374
  // If we were blocking a migration, see if it's now possible to continue.                                 // 1375
  // Call whenever the set of outstanding/blocked methods shrinks.                                          // 1376
  _maybeMigrate: function () {                                                                              // 1377
    var self = this;                                                                                        // 1378
    if (self._retryMigrate && self._readyToMigrate()) {                                                     // 1379
      self._retryMigrate();                                                                                 // 1380
      self._retryMigrate = null;                                                                            // 1381
    }                                                                                                       // 1382
  }                                                                                                         // 1383
});                                                                                                         // 1384
                                                                                                            // 1385
LivedataTest.Connection = Connection;                                                                       // 1386
                                                                                                            // 1387
// @param url {String} URL to Meteor app,                                                                   // 1388
//     e.g.:                                                                                                // 1389
//     "subdomain.meteor.com",                                                                              // 1390
//     "http://subdomain.meteor.com",                                                                       // 1391
//     "/",                                                                                                 // 1392
//     "ddp+sockjs://ddp--****-foo.meteor.com/sockjs"                                                       // 1393
//                                                                                                          // 1394
DDP.connect = function (url, _reloadOnUpdate) {                                                             // 1395
  var ret = new Connection(                                                                                 // 1396
    url, {reloadOnUpdate: _reloadOnUpdate});                                                                // 1397
  allConnections.push(ret); // hack. see below.                                                             // 1398
  return ret;                                                                                               // 1399
};                                                                                                          // 1400
                                                                                                            // 1401
// Hack for `spiderable` package: a way to see if the page is done                                          // 1402
// loading all the data it needs.                                                                           // 1403
//                                                                                                          // 1404
allConnections = [];                                                                                        // 1405
DDP._allSubscriptionsReady = function () {                                                                  // 1406
  return _.all(allConnections, function (conn) {                                                            // 1407
    return _.all(conn._subscriptions, function (sub) {                                                      // 1408
      return sub.ready;                                                                                     // 1409
    });                                                                                                     // 1410
  });                                                                                                       // 1411
};                                                                                                          // 1412
                                                                                                            // 1413
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                          //
// packages/livedata/server_convenience.js                                                                  //
//                                                                                                          //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                            //
// Only create a server if we are in an environment with a HTTP server                                      // 1
// (as opposed to, eg, a command-line tool).                                                                // 2
//                                                                                                          // 3
if (Package.webapp) {                                                                                       // 4
  if (process.env.DDP_DEFAULT_CONNECTION_URL) {                                                             // 5
    __meteor_runtime_config__.DDP_DEFAULT_CONNECTION_URL =                                                  // 6
      process.env.DDP_DEFAULT_CONNECTION_URL;                                                               // 7
  }                                                                                                         // 8
                                                                                                            // 9
  Meteor.server = new Server;                                                                               // 10
                                                                                                            // 11
  Meteor.refresh = function (notification) {                                                                // 12
    var fence = DDPServer._CurrentWriteFence.get();                                                         // 13
    if (fence) {                                                                                            // 14
      // Block the write fence until all of the invalidations have                                          // 15
      // landed.                                                                                            // 16
      var proxy_write = fence.beginWrite();                                                                 // 17
    }                                                                                                       // 18
    DDPServer._InvalidationCrossbar.fire(notification, function () {                                        // 19
      if (proxy_write)                                                                                      // 20
        proxy_write.committed();                                                                            // 21
    });                                                                                                     // 22
  };                                                                                                        // 23
                                                                                                            // 24
  // Proxy the public methods of Meteor.server so they can                                                  // 25
  // be called directly on Meteor.                                                                          // 26
  _.each(['publish', 'methods', 'call', 'apply'],                                                           // 27
         function (name) {                                                                                  // 28
           Meteor[name] = _.bind(Meteor.server[name], Meteor.server);                                       // 29
         });                                                                                                // 30
} else {                                                                                                    // 31
  // No server? Make these empty/no-ops.                                                                    // 32
  Meteor.server = null;                                                                                     // 33
  Meteor.refresh = function (notificatio) {                                                                 // 34
  };                                                                                                        // 35
}                                                                                                           // 36
                                                                                                            // 37
// Meteor.server used to be called Meteor.default_server. Provide                                           // 38
// backcompat as a courtesy even though it was never documented.                                            // 39
// XXX COMPAT WITH 0.6.4                                                                                    // 40
Meteor.default_server = Meteor.server;                                                                      // 41
                                                                                                            // 42
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.livedata = {
  DDP: DDP,
  DDPServer: DDPServer,
  LivedataTest: LivedataTest
};

})();
