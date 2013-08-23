(function () {

/* Imports */
var _ = Package.underscore._;

/* Package-scope variables */
var Meteor;

(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/server_environment.js                                                            //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
Meteor = {                                                                                          // 1
  isClient: false,                                                                                  // 2
  isServer: true                                                                                    // 3
};                                                                                                  // 4
                                                                                                    // 5
Meteor.settings = {};                                                                               // 6
if (process.env.METEOR_SETTINGS) {                                                                  // 7
  try {                                                                                             // 8
    Meteor.settings = JSON.parse(process.env.METEOR_SETTINGS);                                      // 9
  } catch (e) {                                                                                     // 10
    throw new Error("Settings are not valid JSON");                                                 // 11
  }                                                                                                 // 12
}                                                                                                   // 13
// Push a subset of settings to the client.                                                         // 14
if (Meteor.settings && Meteor.settings.public &&                                                    // 15
    typeof __meteor_runtime_config__ === "object") {                                                // 16
  __meteor_runtime_config__.PUBLIC_SETTINGS = Meteor.settings.public;                               // 17
}                                                                                                   // 18
                                                                                                    // 19
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/helpers.js                                                                       //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
if (Meteor.isServer)                                                                                // 1
  var Future = Npm.require('fibers/future');                                                        // 2
                                                                                                    // 3
if (typeof __meteor_runtime_config__ === 'object' &&                                                // 4
    __meteor_runtime_config__.meteorRelease)                                                        // 5
  Meteor.release = __meteor_runtime_config__.meteorRelease;                                         // 6
                                                                                                    // 7
// XXX find a better home for these? Ideally they would be _.get,                                   // 8
// _.ensure, _.delete..                                                                             // 9
                                                                                                    // 10
_.extend(Meteor, {                                                                                  // 11
  // _get(a,b,c,d) returns a[b][c][d], or else undefined if a[b] or                                 // 12
  // a[b][c] doesn't exist.                                                                         // 13
  //                                                                                                // 14
  _get: function (obj /*, arguments */) {                                                           // 15
    for (var i = 1; i < arguments.length; i++) {                                                    // 16
      if (!(arguments[i] in obj))                                                                   // 17
        return undefined;                                                                           // 18
      obj = obj[arguments[i]];                                                                      // 19
    }                                                                                               // 20
    return obj;                                                                                     // 21
  },                                                                                                // 22
                                                                                                    // 23
  // _ensure(a,b,c,d) ensures that a[b][c][d] exists. If it does not,                               // 24
  // it is created and set to {}. Either way, it is returned.                                       // 25
  //                                                                                                // 26
  _ensure: function (obj /*, arguments */) {                                                        // 27
    for (var i = 1; i < arguments.length; i++) {                                                    // 28
      var key = arguments[i];                                                                       // 29
      if (!(key in obj))                                                                            // 30
        obj[key] = {};                                                                              // 31
      obj = obj[key];                                                                               // 32
    }                                                                                               // 33
                                                                                                    // 34
    return obj;                                                                                     // 35
  },                                                                                                // 36
                                                                                                    // 37
  // _delete(a, b, c, d) deletes a[b][c][d], then a[b][c] unless it                                 // 38
  // isn't empty, then a[b] unless it isn't empty.                                                  // 39
  //                                                                                                // 40
  _delete: function (obj /*, arguments */) {                                                        // 41
    var stack = [obj];                                                                              // 42
    var leaf = true;                                                                                // 43
    for (var i = 1; i < arguments.length - 1; i++) {                                                // 44
      var key = arguments[i];                                                                       // 45
      if (!(key in obj)) {                                                                          // 46
        leaf = false;                                                                               // 47
        break;                                                                                      // 48
      }                                                                                             // 49
      obj = obj[key];                                                                               // 50
      if (typeof obj !== "object")                                                                  // 51
        break;                                                                                      // 52
      stack.push(obj);                                                                              // 53
    }                                                                                               // 54
                                                                                                    // 55
    for (var i = stack.length - 1; i >= 0; i--) {                                                   // 56
      var key = arguments[i+1];                                                                     // 57
                                                                                                    // 58
      if (leaf)                                                                                     // 59
        leaf = false;                                                                               // 60
      else                                                                                          // 61
        for (var other in stack[i][key])                                                            // 62
          return; // not empty -- we're done                                                        // 63
                                                                                                    // 64
      delete stack[i][key];                                                                         // 65
    }                                                                                               // 66
  },                                                                                                // 67
                                                                                                    // 68
  // _wrapAsync can wrap any function that takes some number of arguments that                      // 69
  // can't be undefined, followed by some optional arguments, where the callback                    // 70
  // is the last optional argument.                                                                 // 71
  // e.g. fs.readFile(pathname, [callback]),                                                        // 72
  // fs.open(pathname, flags, [mode], [callback])                                                   // 73
  // For maximum effectiveness and least confusion, wrapAsync should be used on                     // 74
  // functions where the callback is the only argument of type Function.                            // 75
  //                                                                                                // 76
  _wrapAsync: function (fn) {                                                                       // 77
    return function (/* arguments */) {                                                             // 78
      var self = this;                                                                              // 79
      var callback;                                                                                 // 80
      var fut;                                                                                      // 81
      var newArgs = _.toArray(arguments);                                                           // 82
                                                                                                    // 83
      var logErr = function (err) {                                                                 // 84
        if (err)                                                                                    // 85
          return Meteor._debug("Exception in callback of async function",                           // 86
                               err ? err.stack : err);                                              // 87
      };                                                                                            // 88
                                                                                                    // 89
      // Pop off optional args that are undefined                                                   // 90
      while (newArgs.length > 0 &&                                                                  // 91
             typeof(newArgs[newArgs.length - 1]) === "undefined") {                                 // 92
        newArgs.pop();                                                                              // 93
      }                                                                                             // 94
      // If we have any left and the last one is a function, then that's our                        // 95
      // callback; otherwise, we don't have one.                                                    // 96
      if (newArgs.length > 0 &&                                                                     // 97
          newArgs[newArgs.length - 1] instanceof Function) {                                        // 98
        callback = newArgs.pop();                                                                   // 99
      } else {                                                                                      // 100
        if (Meteor.isClient) {                                                                      // 101
          callback = logErr;                                                                        // 102
        } else {                                                                                    // 103
          fut = new Future();                                                                       // 104
          callback = fut.resolver();                                                                // 105
        }                                                                                           // 106
      }                                                                                             // 107
      newArgs.push(Meteor.bindEnvironment(callback, logErr));                                       // 108
      var result = fn.apply(self, newArgs);                                                         // 109
      if (fut)                                                                                      // 110
        return fut.wait();                                                                          // 111
      return result;                                                                                // 112
    };                                                                                              // 113
  }                                                                                                 // 114
});                                                                                                 // 115
                                                                                                    // 116
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/setimmediate.js                                                                  //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
// Chooses one of three setImmediate implementations:                                               // 1
//                                                                                                  // 2
// * Native setImmediate (IE 10, Node 0.9+)                                                         // 3
//                                                                                                  // 4
// * postMessage (many browsers)                                                                    // 5
//                                                                                                  // 6
// * setTimeout  (fallback)                                                                         // 7
//                                                                                                  // 8
// The postMessage implementation is based on                                                       // 9
// https://github.com/NobleJS/setImmediate/tree/1.0.1                                               // 10
//                                                                                                  // 11
// Don't use `nextTick` for Node since it runs its callbacks before                                 // 12
// I/O, which is stricter than we're looking for.                                                   // 13
//                                                                                                  // 14
// Not installed as a polyfill, as our public API is `Meteor.defer`.                                // 15
// Since we're not trying to be a polyfill, we have some                                            // 16
// simplifications:                                                                                 // 17
//                                                                                                  // 18
// If one invocation of a setImmediate callback pauses itself by a                                  // 19
// call to alert/prompt/showModelDialog, the NobleJS polyfill                                       // 20
// implementation ensured that no setImmedate callback would run until                              // 21
// the first invocation completed.  While correct per the spec, what it                             // 22
// would mean for us in practice is that any reactive updates relying                               // 23
// on Meteor.defer would be hung in the main window until the modal                                 // 24
// dialog was dismissed.  Thus we only ensure that a setImmediate                                   // 25
// function is called in a later event loop.                                                        // 26
//                                                                                                  // 27
// We don't need to support using a string to be eval'ed for the                                    // 28
// callback, arguments to the function, or clearImmediate.                                          // 29
                                                                                                    // 30
"use strict";                                                                                       // 31
                                                                                                    // 32
var global = this;                                                                                  // 33
                                                                                                    // 34
                                                                                                    // 35
// IE 10, Node >= 9.1                                                                               // 36
                                                                                                    // 37
function useSetImmediate() {                                                                        // 38
  if (! global.setImmediate)                                                                        // 39
    return null;                                                                                    // 40
  else {                                                                                            // 41
    var setImmediate = function (fn) {                                                              // 42
      global.setImmediate(fn);                                                                      // 43
    };                                                                                              // 44
    setImmediate.implementation = 'setImmediate';                                                   // 45
    return setImmediate;                                                                            // 46
  }                                                                                                 // 47
}                                                                                                   // 48
                                                                                                    // 49
                                                                                                    // 50
// Android 2.3.6, Chrome 26, Firefox 20, IE 8-9, iOS 5.1.1 Safari                                   // 51
                                                                                                    // 52
function usePostMessage() {                                                                         // 53
  // The test against `importScripts` prevents this implementation                                  // 54
  // from being installed inside a web worker, where                                                // 55
  // `global.postMessage` means something completely different and                                  // 56
  // can't be used for this purpose.                                                                // 57
                                                                                                    // 58
  if (!global.postMessage || global.importScripts) {                                                // 59
    return null;                                                                                    // 60
  }                                                                                                 // 61
                                                                                                    // 62
  // Avoid synchronous post message implementations.                                                // 63
                                                                                                    // 64
  var postMessageIsAsynchronous = true;                                                             // 65
  var oldOnMessage = global.onmessage;                                                              // 66
  global.onmessage = function () {                                                                  // 67
      postMessageIsAsynchronous = false;                                                            // 68
  };                                                                                                // 69
  global.postMessage("", "*");                                                                      // 70
  global.onmessage = oldOnMessage;                                                                  // 71
                                                                                                    // 72
  if (! postMessageIsAsynchronous)                                                                  // 73
    return null;                                                                                    // 74
                                                                                                    // 75
  var funcIndex = 0;                                                                                // 76
  var funcs = {};                                                                                   // 77
                                                                                                    // 78
  // Installs an event handler on `global` for the `message` event: see                             // 79
  // * https://developer.mozilla.org/en/DOM/window.postMessage                                      // 80
  // * http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#crossDocumentMessages // 81
                                                                                                    // 82
  // XXX use Random.id() here?                                                                      // 83
  var MESSAGE_PREFIX = "Meteor._setImmediate." + Math.random() + '.';                               // 84
                                                                                                    // 85
  function isStringAndStartsWith(string, putativeStart) {                                           // 86
    return (typeof string === "string" &&                                                           // 87
            string.substring(0, putativeStart.length) === putativeStart);                           // 88
  }                                                                                                 // 89
                                                                                                    // 90
  function onGlobalMessage(event) {                                                                 // 91
    // This will catch all incoming messages (even from other                                       // 92
    // windows!), so we need to try reasonably hard to avoid letting                                // 93
    // anyone else trick us into firing off. We test the origin is                                  // 94
    // still this window, and that a (randomly generated)                                           // 95
    // unpredictable identifying prefix is present.                                                 // 96
    if (event.source === global &&                                                                  // 97
        isStringAndStartsWith(event.data, MESSAGE_PREFIX)) {                                        // 98
      var index = event.data.substring(MESSAGE_PREFIX.length);                                      // 99
      try {                                                                                         // 100
        if (funcs[index])                                                                           // 101
          funcs[index]();                                                                           // 102
      }                                                                                             // 103
      finally {                                                                                     // 104
        delete funcs[index];                                                                        // 105
      }                                                                                             // 106
    }                                                                                               // 107
  }                                                                                                 // 108
                                                                                                    // 109
  if (global.addEventListener) {                                                                    // 110
    global.addEventListener("message", onGlobalMessage, false);                                     // 111
  } else {                                                                                          // 112
    global.attachEvent("onmessage", onGlobalMessage);                                               // 113
  }                                                                                                 // 114
                                                                                                    // 115
  var setImmediate = function (fn) {                                                                // 116
    // Make `global` post a message to itself with the handle and                                   // 117
    // identifying prefix, thus asynchronously invoking our                                         // 118
    // onGlobalMessage listener above.                                                              // 119
    ++funcIndex;                                                                                    // 120
    funcs[funcIndex] = fn;                                                                          // 121
    global.postMessage(MESSAGE_PREFIX + funcIndex, "*");                                            // 122
  };                                                                                                // 123
  setImmediate.implementation = 'postMessage';                                                      // 124
  return setImmediate;                                                                              // 125
}                                                                                                   // 126
                                                                                                    // 127
                                                                                                    // 128
function useTimeout() {                                                                             // 129
  var setImmediate = function (fn) {                                                                // 130
    global.setTimeout(fn, 0);                                                                       // 131
  };                                                                                                // 132
  setImmediate.implementation = 'setTimeout';                                                       // 133
  return setImmediate;                                                                              // 134
}                                                                                                   // 135
                                                                                                    // 136
                                                                                                    // 137
Meteor._setImmediate =                                                                              // 138
  useSetImmediate() ||                                                                              // 139
  usePostMessage() ||                                                                               // 140
  useTimeout();                                                                                     // 141
                                                                                                    // 142
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/timers.js                                                                        //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
var withoutInvocation = function (f) {                                                              // 1
  if (Package.livedata) {                                                                           // 2
    var _CurrentInvocation = Package.livedata.DDP._CurrentInvocation;                               // 3
    if (_CurrentInvocation.get() && _CurrentInvocation.get().isSimulation)                          // 4
      throw new Error("Can't set timers inside simulations");                                       // 5
    return function () { _CurrentInvocation.withValue(null, f); };                                  // 6
  }                                                                                                 // 7
  else                                                                                              // 8
    return f;                                                                                       // 9
};                                                                                                  // 10
                                                                                                    // 11
var bindAndCatch = function (context, f) {                                                          // 12
  return Meteor.bindEnvironment(withoutInvocation(f), function (e) {                                // 13
    // XXX report nicely (or, should we catch it at all?)                                           // 14
    Meteor._debug("Exception from " + context + ":", e, e.stack);                                   // 15
  });                                                                                               // 16
};                                                                                                  // 17
                                                                                                    // 18
_.extend(Meteor, {                                                                                  // 19
  // Meteor.setTimeout and Meteor.setInterval callbacks scheduled                                   // 20
  // inside a server method are not part of the method invocation and                               // 21
  // should clear out the CurrentInvocation environment variable.                                   // 22
                                                                                                    // 23
  setTimeout: function (f, duration) {                                                              // 24
    return setTimeout(bindAndCatch("setTimeout callback", f), duration);                            // 25
  },                                                                                                // 26
                                                                                                    // 27
  setInterval: function (f, duration) {                                                             // 28
    return setInterval(bindAndCatch("setInterval callback", f), duration);                          // 29
  },                                                                                                // 30
                                                                                                    // 31
  clearInterval: function(x) {                                                                      // 32
    return clearInterval(x);                                                                        // 33
  },                                                                                                // 34
                                                                                                    // 35
  clearTimeout: function(x) {                                                                       // 36
    return clearTimeout(x);                                                                         // 37
  },                                                                                                // 38
                                                                                                    // 39
  // XXX consider making this guarantee ordering of defer'd callbacks, like                         // 40
  // Deps.afterFlush or Node's nextTick (in practice). Then tests can do:                           // 41
  //    callSomethingThatDefersSomeWork();                                                          // 42
  //    Meteor.defer(expect(somethingThatValidatesThatTheWorkHappened));                            // 43
  defer: function (f) {                                                                             // 44
    Meteor._setImmediate(bindAndCatch("defer callback", f));                                        // 45
  }                                                                                                 // 46
});                                                                                                 // 47
                                                                                                    // 48
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/errors.js                                                                        //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
// http://davidshariff.com/blog/javascript-inheritance-patterns/                                    // 1
var inherits = function (child, parent) {                                                           // 2
  var tmp = function () {};                                                                         // 3
  tmp.prototype = parent.prototype;                                                                 // 4
  child.prototype = new tmp;                                                                        // 5
  child.prototype.constructor = child;                                                              // 6
};                                                                                                  // 7
                                                                                                    // 8
// Makes an error subclass which properly contains a stack trace in most                            // 9
// environments. constructor can set fields on `this` (and should probably set                      // 10
// `message`, which is what gets displayed at the top of a stack trace).                            // 11
//                                                                                                  // 12
Meteor.makeErrorType = function (name, constructor) {                                               // 13
  var errorClass = function (/*arguments*/) {                                                       // 14
    var self = this;                                                                                // 15
                                                                                                    // 16
    // Ensure we get a proper stack trace in most Javascript environments                           // 17
    if (Error.captureStackTrace) {                                                                  // 18
      // V8 environments (Chrome and Node.js)                                                       // 19
      Error.captureStackTrace(self, errorClass);                                                    // 20
    } else {                                                                                        // 21
      // Firefox                                                                                    // 22
      var e = new Error;                                                                            // 23
      e.__proto__ = errorClass.prototype;                                                           // 24
      if (e instanceof errorClass)                                                                  // 25
        self = e;                                                                                   // 26
    }                                                                                               // 27
    // Safari magically works.                                                                      // 28
                                                                                                    // 29
    constructor.apply(self, arguments);                                                             // 30
                                                                                                    // 31
    self.errorType = name;                                                                          // 32
                                                                                                    // 33
    return self;                                                                                    // 34
  };                                                                                                // 35
                                                                                                    // 36
  inherits(errorClass, Error);                                                                      // 37
                                                                                                    // 38
  return errorClass;                                                                                // 39
};                                                                                                  // 40
                                                                                                    // 41
// This should probably be in the livedata package, but we don't want                               // 42
// to require you to use the livedata package to get it. Eventually we                              // 43
// should probably rename it to DDP.Error and put it back in the                                    // 44
// 'livedata' package (which we should rename to 'ddp' also.)                                       // 45
//                                                                                                  // 46
// Note: The DDP server assumes that Meteor.Error EJSON-serializes as an object                     // 47
// containing 'error' and optionally 'reason' and 'details'.                                        // 48
// The DDP client manually puts these into Meteor.Error objects. (We don't use                      // 49
// EJSON.addType here because the type is determined by location in the                             // 50
// protocol, not text on the wire.)                                                                 // 51
//                                                                                                  // 52
Meteor.Error = Meteor.makeErrorType(                                                                // 53
  "Meteor.Error",                                                                                   // 54
  function (error, reason, details) {                                                               // 55
    var self = this;                                                                                // 56
                                                                                                    // 57
    // Currently, a numeric code, likely similar to a HTTP code (eg,                                // 58
    // 404, 500). That is likely to change though.                                                  // 59
    self.error = error;                                                                             // 60
                                                                                                    // 61
    // Optional: A short human-readable summary of the error. Not                                   // 62
    // intended to be shown to end users, just developers. ("Not Found",                            // 63
    // "Internal Server Error")                                                                     // 64
    self.reason = reason;                                                                           // 65
                                                                                                    // 66
    // Optional: Additional information about the error, say for                                    // 67
    // debugging. It might be a (textual) stack trace if the server is                              // 68
    // willing to provide one. The corresponding thing in HTTP would be                             // 69
    // the body of a 404 or 500 response. (The difference is that we                                // 70
    // never expect this to be shown to end users, only developers, so                              // 71
    // it doesn't need to be pretty.)                                                               // 72
    self.details = details;                                                                         // 73
                                                                                                    // 74
    // This is what gets displayed at the top of a stack trace. Current                             // 75
    // format is "[404]" (if no reason is set) or "File not found [404]"                            // 76
    if (self.reason)                                                                                // 77
      self.message = self.reason + ' [' + self.error + ']';                                         // 78
    else                                                                                            // 79
      self.message = '[' + self.error + ']';                                                        // 80
  });                                                                                               // 81
                                                                                                    // 82
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/fiber_helpers.js                                                                 //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
var path = Npm.require('path');                                                                     // 1
var Fiber = Npm.require('fibers');                                                                  // 2
var Future = Npm.require(path.join('fibers', 'future'));                                            // 3
                                                                                                    // 4
Meteor._noYieldsAllowed = function (f) {                                                            // 5
  // "Fiber" and "yield" are both in the global namespace. The yield function is                    // 6
  // at both "yield" and "Fiber.yield". (It's also at require('fibers').yield                       // 7
  // but that is because require('fibers') === Fiber.)                                              // 8
  var savedYield = Fiber.yield;                                                                     // 9
  Fiber.yield = function () {                                                                       // 10
    throw new Error("Can't call yield in a noYieldsAllowed block!");                                // 11
  };                                                                                                // 12
  global.yield = Fiber.yield;                                                                       // 13
  try {                                                                                             // 14
    return f();                                                                                     // 15
  } finally {                                                                                       // 16
    Fiber.yield = savedYield;                                                                       // 17
    global.yield = savedYield;                                                                      // 18
  }                                                                                                 // 19
};                                                                                                  // 20
                                                                                                    // 21
// Meteor._SynchronousQueue is a queue which runs task functions serially.                          // 22
// Tasks are assumed to be synchronous: ie, it's assumed that they are                              // 23
// done when they return.                                                                           // 24
//                                                                                                  // 25
// It has two methods:                                                                              // 26
//   - queueTask queues a task to be run, and returns immediately.                                  // 27
//   - runTask queues a task to be run, and then yields. It returns                                 // 28
//     when the task finishes running.                                                              // 29
//                                                                                                  // 30
// It's safe to call queueTask from within a task, but not runTask (unless                          // 31
// you're calling runTask from a nested Fiber).                                                     // 32
//                                                                                                  // 33
// Somewhat inspired by async.queue, but specific to blocking tasks.                                // 34
// XXX break this out into an NPM module?                                                           // 35
// XXX could maybe use the npm 'schlock' module instead, which would                                // 36
//     also support multiple concurrent "read" tasks                                                // 37
//                                                                                                  // 38
Meteor._SynchronousQueue = function () {                                                            // 39
  var self = this;                                                                                  // 40
  // List of tasks to run (not including a currently-running task if any). Each                     // 41
  // is an object with field 'task' (the task function to run) and 'future' (the                    // 42
  // Future associated with the blocking runTask call that queued it, or null if                    // 43
  // called from queueTask).                                                                        // 44
  self._taskHandles = [];                                                                           // 45
  // This is true if self._run() is either currently executing or scheduled to                      // 46
  // do so soon.                                                                                    // 47
  self._runningOrRunScheduled = false;                                                              // 48
  // During the execution of a task, this is set to the fiber used to execute                       // 49
  // that task. We use this to throw an error rather than deadlocking if the                        // 50
  // user calls runTask from within a task on the same fiber.                                       // 51
  self._currentTaskFiber = undefined;                                                               // 52
  // This is true if we're currently draining.  While we're draining, a further                     // 53
  // drain is a noop, to prevent infinite loops.  "drain" is a heuristic type                       // 54
  // operation, that has a meaning like unto "what a naive person would expect                      // 55
  // when modifying a table from an observe"                                                        // 56
  self._draining = false;                                                                           // 57
};                                                                                                  // 58
                                                                                                    // 59
_.extend(Meteor._SynchronousQueue.prototype, {                                                      // 60
  runTask: function (task) {                                                                        // 61
    var self = this;                                                                                // 62
                                                                                                    // 63
    if (!self.safeToRunTask()) {                                                                    // 64
      if (Fiber.current)                                                                            // 65
        throw new Error("Can't runTask from another task in the same fiber");                       // 66
      else                                                                                          // 67
        throw new Error("Can only call runTask in a Fiber");                                        // 68
    }                                                                                               // 69
                                                                                                    // 70
    var fut = new Future;                                                                           // 71
    self._taskHandles.push({task: Meteor.bindEnvironment(task, function (e) {                       // 72
      Meteor._debug("Exception from task:", e ? e.stack : e);                                       // 73
      throw e;                                                                                      // 74
    }), future: fut});                                                                              // 75
    self._scheduleRun();                                                                            // 76
    // Yield. We'll get back here after the task is run (and will throw if the                      // 77
    // task throws).                                                                                // 78
    fut.wait();                                                                                     // 79
  },                                                                                                // 80
  queueTask: function (task) {                                                                      // 81
    var self = this;                                                                                // 82
    self._taskHandles.push({task: task});                                                           // 83
    self._scheduleRun();                                                                            // 84
    // No need to block.                                                                            // 85
  },                                                                                                // 86
                                                                                                    // 87
  flush: function () {                                                                              // 88
    var self = this;                                                                                // 89
    self.runTask(function () {});                                                                   // 90
  },                                                                                                // 91
                                                                                                    // 92
  safeToRunTask: function () {                                                                      // 93
    var self = this;                                                                                // 94
    return Fiber.current && self._currentTaskFiber !== Fiber.current;                               // 95
  },                                                                                                // 96
                                                                                                    // 97
  drain: function () {                                                                              // 98
    var self = this;                                                                                // 99
    if (self._draining)                                                                             // 100
      return;                                                                                       // 101
    if (!self.safeToRunTask())                                                                      // 102
      return;                                                                                       // 103
    self._draining = true;                                                                          // 104
    while (!_.isEmpty(self._taskHandles)) {                                                         // 105
      self.flush();                                                                                 // 106
    }                                                                                               // 107
    self._draining = false;                                                                         // 108
  },                                                                                                // 109
                                                                                                    // 110
  _scheduleRun: function () {                                                                       // 111
    var self = this;                                                                                // 112
                                                                                                    // 113
    // Already running or scheduled? Do nothing.                                                    // 114
    if (self._runningOrRunScheduled)                                                                // 115
      return;                                                                                       // 116
                                                                                                    // 117
    self._runningOrRunScheduled = true;                                                             // 118
                                                                                                    // 119
    process.nextTick(function () {                                                                  // 120
      Fiber(function () {                                                                           // 121
        self._run();                                                                                // 122
      }).run();                                                                                     // 123
    });                                                                                             // 124
  },                                                                                                // 125
  _run: function () {                                                                               // 126
    var self = this;                                                                                // 127
                                                                                                    // 128
    if (!self._runningOrRunScheduled)                                                               // 129
      throw new Error("expected to be _runningOrRunScheduled");                                     // 130
                                                                                                    // 131
    if (_.isEmpty(self._taskHandles)) {                                                             // 132
      // Done running tasks! Don't immediately schedule another run, but                            // 133
      // allow future tasks to do so.                                                               // 134
      self._runningOrRunScheduled = false;                                                          // 135
      return;                                                                                       // 136
    }                                                                                               // 137
    var taskHandle = self._taskHandles.shift();                                                     // 138
                                                                                                    // 139
    // Run the task.                                                                                // 140
    self._currentTaskFiber = Fiber.current;                                                         // 141
    var exception = undefined;                                                                      // 142
    try {                                                                                           // 143
      taskHandle.task();                                                                            // 144
    } catch (err) {                                                                                 // 145
      if (taskHandle.future) {                                                                      // 146
        // We'll throw this exception through runTask.                                              // 147
        exception = err;                                                                            // 148
      } else {                                                                                      // 149
        Meteor._debug("Exception in queued task: " + err.stack);                                    // 150
      }                                                                                             // 151
    }                                                                                               // 152
    self._currentTaskFiber = undefined;                                                             // 153
                                                                                                    // 154
    // Soon, run the next task, if there is any.                                                    // 155
    self._runningOrRunScheduled = false;                                                            // 156
    self._scheduleRun();                                                                            // 157
                                                                                                    // 158
    // If this was queued with runTask, let the runTask call return (throwing if                    // 159
    // the task threw).                                                                             // 160
    if (taskHandle.future) {                                                                        // 161
      if (exception)                                                                                // 162
        taskHandle.future['throw'](exception);                                                      // 163
      else                                                                                          // 164
        taskHandle.future['return']();                                                              // 165
    }                                                                                               // 166
  }                                                                                                 // 167
});                                                                                                 // 168
                                                                                                    // 169
// Sleep. Mostly used for debugging (eg, inserting latency into server                              // 170
// methods).                                                                                        // 171
//                                                                                                  // 172
Meteor._sleepForMs = function (ms) {                                                                // 173
  var fiber = Fiber.current;                                                                        // 174
  setTimeout(function() {                                                                           // 175
    fiber.run();                                                                                    // 176
  }, ms);                                                                                           // 177
  Fiber.yield();                                                                                    // 178
};                                                                                                  // 179
                                                                                                    // 180
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/startup_server.js                                                                //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
Meteor.startup = function (callback) {                                                              // 1
  __meteor_bootstrap__.startup_hooks.push(callback);                                                // 2
};                                                                                                  // 3
                                                                                                    // 4
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/debug.js                                                                         //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
var suppress = 0;                                                                                   // 1
                                                                                                    // 2
// replacement for console.log. This is a temporary API. We should                                  // 3
// provide a real logging API soon (possibly just a polyfill for                                    // 4
// console?)                                                                                        // 5
//                                                                                                  // 6
// NOTE: this is used on the server to print the warning about                                      // 7
// having autopublish enabled when you probably meant to turn it                                    // 8
// off. it's not really the proper use of something called                                          // 9
// _debug. the intent is for this message to go to the terminal and                                 // 10
// be very visible. if you change _debug to go someplace else, etc,                                 // 11
// please fix the autopublish code to do something reasonable.                                      // 12
//                                                                                                  // 13
Meteor._debug = function (/* arguments */) {                                                        // 14
  if (suppress) {                                                                                   // 15
    suppress--;                                                                                     // 16
    return;                                                                                         // 17
  }                                                                                                 // 18
  if (typeof console !== 'undefined' &&                                                             // 19
      typeof console.log !== 'undefined') {                                                         // 20
    if (arguments.length == 0) { // IE Companion breaks otherwise                                   // 21
      // IE10 PP4 requires at least one argument                                                    // 22
      console.log('');                                                                              // 23
    } else {                                                                                        // 24
      // IE doesn't have console.log.apply, it's not a real Object.                                 // 25
      // http://stackoverflow.com/questions/5538972/console-log-apply-not-working-in-ie9            // 26
      // http://patik.com/blog/complete-cross-browser-console-log/                                  // 27
      if (typeof console.log.apply === "function") {                                                // 28
        // Most browsers                                                                            // 29
                                                                                                    // 30
        // Chrome and Safari only hyperlink URLs to source files in first argument of               // 31
        // console.log, so try to call it with one argument if possible.                            // 32
        // Approach taken here: If all arguments are strings, join them on space.                   // 33
        // See https://github.com/meteor/meteor/pull/732#issuecomment-13975991                      // 34
        var allArgumentsOfTypeString = true;                                                        // 35
        for (var i = 0; i < arguments.length; i++)                                                  // 36
          if (typeof arguments[i] !== "string")                                                     // 37
            allArgumentsOfTypeString = false;                                                       // 38
                                                                                                    // 39
        if (allArgumentsOfTypeString)                                                               // 40
          console.log.apply(console, [Array.prototype.join.call(arguments, " ")]);                  // 41
        else                                                                                        // 42
          console.log.apply(console, arguments);                                                    // 43
                                                                                                    // 44
      } else if (typeof Function.prototype.bind === "function") {                                   // 45
        // IE9                                                                                      // 46
        var log = Function.prototype.bind.call(console.log, console);                               // 47
        log.apply(console, arguments);                                                              // 48
      } else {                                                                                      // 49
        // IE8                                                                                      // 50
        Function.prototype.call.call(console.log, console, Array.prototype.slice.call(arguments));  // 51
      }                                                                                             // 52
    }                                                                                               // 53
  }                                                                                                 // 54
};                                                                                                  // 55
                                                                                                    // 56
// Suppress the next 'count' Meteor._debug messsages. Use this to                                   // 57
// stop tests from spamming the console.                                                            // 58
//                                                                                                  // 59
Meteor._suppress_log = function (count) {                                                           // 60
  suppress += count;                                                                                // 61
};                                                                                                  // 62
                                                                                                    // 63
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/dynamics_nodejs.js                                                               //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
// Fiber-aware implementation of dynamic scoping, for use on the server                             // 1
                                                                                                    // 2
var Fiber = Npm.require('fibers');                                                                  // 3
                                                                                                    // 4
var nextSlot = 0;                                                                                   // 5
                                                                                                    // 6
Meteor.EnvironmentVariable = function () {                                                          // 7
  this.slot = nextSlot++;                                                                           // 8
};                                                                                                  // 9
                                                                                                    // 10
_.extend(Meteor.EnvironmentVariable.prototype, {                                                    // 11
  get: function () {                                                                                // 12
    if (!Fiber.current)                                                                             // 13
      throw new Error("Meteor code must always run within a Fiber");                                // 14
                                                                                                    // 15
    return Fiber.current._meteor_dynamics &&                                                        // 16
      Fiber.current._meteor_dynamics[this.slot];                                                    // 17
  },                                                                                                // 18
                                                                                                    // 19
  withValue: function (value, func) {                                                               // 20
    if (!Fiber.current)                                                                             // 21
      throw new Error("Meteor code must always run within a Fiber");                                // 22
                                                                                                    // 23
    if (!Fiber.current._meteor_dynamics)                                                            // 24
      Fiber.current._meteor_dynamics = [];                                                          // 25
    var currentValues = Fiber.current._meteor_dynamics;                                             // 26
                                                                                                    // 27
    var saved = currentValues[this.slot];                                                           // 28
    try {                                                                                           // 29
      currentValues[this.slot] = value;                                                             // 30
      var ret = func();                                                                             // 31
    } finally {                                                                                     // 32
      currentValues[this.slot] = saved;                                                             // 33
    }                                                                                               // 34
                                                                                                    // 35
    return ret;                                                                                     // 36
  }                                                                                                 // 37
});                                                                                                 // 38
                                                                                                    // 39
// Meteor application code is always supposed to be run inside a                                    // 40
// fiber. bindEnvironment ensures that the function it wraps is run from                            // 41
// inside a fiber and ensures it sees the values of Meteor environment                              // 42
// variables that are set at the time bindEnvironment is called.                                    // 43
//                                                                                                  // 44
// If an environment-bound function is called from outside a fiber (eg, from                        // 45
// an asynchronous callback from a non-Meteor library such as MongoDB), it'll                       // 46
// kick off a new fiber to execute the function, and returns undefined as soon                      // 47
// as that fiber returns or yields (and func's return value is ignored).                            // 48
//                                                                                                  // 49
// If it's called inside a fiber, it works normally (the                                            // 50
// return value of the function will be passed through, and no new                                  // 51
// fiber will be created.)                                                                          // 52
//                                                                                                  // 53
Meteor.bindEnvironment = function (func, onException, _this) {                                      // 54
  var boundValues = _.clone(Fiber.current._meteor_dynamics || []);                                  // 55
                                                                                                    // 56
  if (!onException)                                                                                 // 57
    throw new Error("onException must be supplied");                                                // 58
                                                                                                    // 59
  return function (/* arguments */) {                                                               // 60
    var args = _.toArray(arguments);                                                                // 61
                                                                                                    // 62
    var runWithEnvironment = function () {                                                          // 63
      var savedValues = Fiber.current._meteor_dynamics;                                             // 64
      try {                                                                                         // 65
        // Need to clone boundValues in case two fibers invoke this                                 // 66
        // function at the same time                                                                // 67
        Fiber.current._meteor_dynamics = _.clone(boundValues);                                      // 68
        var ret = func.apply(_this, args);                                                          // 69
      } catch (e) {                                                                                 // 70
        onException(e);                                                                             // 71
      } finally {                                                                                   // 72
        Fiber.current._meteor_dynamics = savedValues;                                               // 73
      }                                                                                             // 74
      return ret;                                                                                   // 75
    };                                                                                              // 76
                                                                                                    // 77
    if (Fiber.current)                                                                              // 78
      return runWithEnvironment();                                                                  // 79
    Fiber(runWithEnvironment).run();                                                                // 80
  };                                                                                                // 81
};                                                                                                  // 82
                                                                                                    // 83
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/url_server.js                                                                    //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
if (process.env.ROOT_URL &&                                                                         // 1
    typeof __meteor_runtime_config__ === "object") {                                                // 2
  __meteor_runtime_config__.ROOT_URL = process.env.ROOT_URL;                                        // 3
  var pathPrefix = Npm.require('url').parse(__meteor_runtime_config__.ROOT_URL).pathname;           // 4
  __meteor_runtime_config__.ROOT_URL_PATH_PREFIX = pathPrefix === "/" ? "" : pathPrefix;            // 5
}                                                                                                   // 6
                                                                                                    // 7
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                  //
// packages/meteor/url_common.js                                                                    //
//                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                    //
Meteor.absoluteUrl = function (path, options) {                                                     // 1
  // path is optional                                                                               // 2
  if (!options && typeof path === 'object') {                                                       // 3
    options = path;                                                                                 // 4
    path = undefined;                                                                               // 5
  }                                                                                                 // 6
  // merge options with defaults                                                                    // 7
  options = _.extend({}, Meteor.absoluteUrl.defaultOptions, options || {});                         // 8
                                                                                                    // 9
  var url = options.rootUrl;                                                                        // 10
  if (!url)                                                                                         // 11
    throw new Error("Must pass options.rootUrl or set ROOT_URL in the server environment");         // 12
                                                                                                    // 13
  if (!/^http[s]?:\/\//i.test(url)) // url starts with 'http://' or 'https://'                      // 14
    url = 'http://' + url; // we will later fix to https if options.secure is set                   // 15
                                                                                                    // 16
  if (!/\/$/.test(url)) // url ends with '/'                                                        // 17
    url += '/';                                                                                     // 18
                                                                                                    // 19
  if (path)                                                                                         // 20
    url += path;                                                                                    // 21
                                                                                                    // 22
  // turn http to http if secure option is set, and we're not talking                               // 23
  // to localhost.                                                                                  // 24
  if (options.secure &&                                                                             // 25
      /^http:/.test(url) && // url starts with 'http:'                                              // 26
      !/http:\/\/localhost[:\/]/.test(url) && // doesn't match localhost                            // 27
      !/http:\/\/127\.0\.0\.1[:\/]/.test(url)) // or 127.0.0.1                                      // 28
    url = url.replace(/^http:/, 'https:');                                                          // 29
                                                                                                    // 30
  if (options.replaceLocalhost)                                                                     // 31
    url = url.replace(/^http:\/\/localhost([:\/].*)/, 'http://127.0.0.1$1');                        // 32
                                                                                                    // 33
  return url;                                                                                       // 34
};                                                                                                  // 35
                                                                                                    // 36
// allow later packages to override default options                                                 // 37
Meteor.absoluteUrl.defaultOptions = { };                                                            // 38
if (typeof __meteor_runtime_config__ === "object" &&                                                // 39
    __meteor_runtime_config__.ROOT_URL)                                                             // 40
  Meteor.absoluteUrl.defaultOptions.rootUrl = __meteor_runtime_config__.ROOT_URL;                   // 41
                                                                                                    // 42
                                                                                                    // 43
Meteor._relativeToSiteRootUrl = function (link) {                                                   // 44
  if (typeof __meteor_runtime_config__ === "object" &&                                              // 45
      link.substr(0, 1) === "/")                                                                    // 46
    link = (__meteor_runtime_config__.ROOT_URL_PATH_PREFIX || "") + link;                           // 47
  return link;                                                                                      // 48
};                                                                                                  // 49
                                                                                                    // 50
//////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.meteor = {
  Meteor: Meteor
};

})();
