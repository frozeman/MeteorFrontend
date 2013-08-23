(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;

/* Package-scope variables */
var Deps;

(function () {

//////////////////////////////////////////////////////////////////////////////////
//                                                                              //
// packages/deps/deps.js                                                        //
//                                                                              //
//////////////////////////////////////////////////////////////////////////////////
                                                                                //
Deps = {};                                                                      // 1
Deps.active = false;                                                            // 2
Deps.currentComputation = null;                                                 // 3
                                                                                // 4
var setCurrentComputation = function (c) {                                      // 5
  Deps.currentComputation = c;                                                  // 6
  Deps.active = !! c;                                                           // 7
};                                                                              // 8
                                                                                // 9
var _debugFunc = function () {                                                  // 10
  // lazy evaluation because `Meteor` does not exist right away                 // 11
  return (typeof Meteor !== "undefined" ? Meteor._debug :                       // 12
          ((typeof console !== "undefined") && console.log ? console.log :      // 13
           function () {}));                                                    // 14
};                                                                              // 15
                                                                                // 16
var nextId = 1;                                                                 // 17
// computations whose callbacks we should call at flush time                    // 18
var pendingComputations = [];                                                   // 19
// `true` if a Deps.flush is scheduled, or if we are in Deps.flush now          // 20
var willFlush = false;                                                          // 21
// `true` if we are in Deps.flush now                                           // 22
var inFlush = false;                                                            // 23
// `true` if we are computing a computation now, either first time              // 24
// or recompute.  This matches Deps.active unless we are inside                 // 25
// Deps.nonreactive, which nullfies currentComputation even though              // 26
// an enclosing computation may still be running.                               // 27
var inCompute = false;                                                          // 28
                                                                                // 29
var afterFlushCallbacks = [];                                                   // 30
                                                                                // 31
var requireFlush = function () {                                                // 32
  if (! willFlush) {                                                            // 33
    setTimeout(Deps.flush, 0);                                                  // 34
    willFlush = true;                                                           // 35
  }                                                                             // 36
};                                                                              // 37
                                                                                // 38
// Deps.Computation constructor is visible but private                          // 39
// (throws an error if you try to call it)                                      // 40
var constructingComputation = false;                                            // 41
                                                                                // 42
Deps.Computation = function (f, parent) {                                       // 43
  if (! constructingComputation)                                                // 44
    throw new Error(                                                            // 45
      "Deps.Computation constructor is private; use Deps.autorun");             // 46
  constructingComputation = false;                                              // 47
                                                                                // 48
  var self = this;                                                              // 49
  self.stopped = false;                                                         // 50
  self.invalidated = false;                                                     // 51
  self.firstRun = true;                                                         // 52
                                                                                // 53
  self._id = nextId++;                                                          // 54
  self._onInvalidateCallbacks = [];                                             // 55
  // the plan is at some point to use the parent relation                       // 56
  // to constrain the order that computations are processed                     // 57
  self._parent = parent;                                                        // 58
  self._func = f;                                                               // 59
  self._recomputing = false;                                                    // 60
                                                                                // 61
  var errored = true;                                                           // 62
  try {                                                                         // 63
    self._compute();                                                            // 64
    errored = false;                                                            // 65
  } finally {                                                                   // 66
    self.firstRun = false;                                                      // 67
    if (errored)                                                                // 68
      self.stop();                                                              // 69
  }                                                                             // 70
};                                                                              // 71
                                                                                // 72
_.extend(Deps.Computation.prototype, {                                          // 73
                                                                                // 74
  onInvalidate: function (f) {                                                  // 75
    var self = this;                                                            // 76
                                                                                // 77
    if (typeof f !== 'function')                                                // 78
      throw new Error("onInvalidate requires a function");                      // 79
                                                                                // 80
    var g = function () {                                                       // 81
      Deps.nonreactive(function () {                                            // 82
        f(self);                                                                // 83
      });                                                                       // 84
    };                                                                          // 85
                                                                                // 86
    if (self.invalidated)                                                       // 87
      g();                                                                      // 88
    else                                                                        // 89
      self._onInvalidateCallbacks.push(g);                                      // 90
  },                                                                            // 91
                                                                                // 92
  invalidate: function () {                                                     // 93
    var self = this;                                                            // 94
    if (! self.invalidated) {                                                   // 95
      // if we're currently in _recompute(), don't enqueue                      // 96
      // ourselves, since we'll rerun immediately anyway.                       // 97
      if (! self._recomputing && ! self.stopped) {                              // 98
        requireFlush();                                                         // 99
        pendingComputations.push(this);                                         // 100
      }                                                                         // 101
                                                                                // 102
      self.invalidated = true;                                                  // 103
                                                                                // 104
      // callbacks can't add callbacks, because                                 // 105
      // self.invalidated === true.                                             // 106
      for(var i = 0, f; f = self._onInvalidateCallbacks[i]; i++)                // 107
        f(); // already bound with self as argument                             // 108
      self._onInvalidateCallbacks = [];                                         // 109
    }                                                                           // 110
  },                                                                            // 111
                                                                                // 112
  stop: function () {                                                           // 113
    if (! this.stopped) {                                                       // 114
      this.stopped = true;                                                      // 115
      this.invalidate();                                                        // 116
    }                                                                           // 117
  },                                                                            // 118
                                                                                // 119
  _compute: function () {                                                       // 120
    var self = this;                                                            // 121
    self.invalidated = false;                                                   // 122
                                                                                // 123
    var previous = Deps.currentComputation;                                     // 124
    setCurrentComputation(self);                                                // 125
    var previousInCompute = inCompute;                                          // 126
    inCompute = true;                                                           // 127
    try {                                                                       // 128
      self._func(self);                                                         // 129
    } finally {                                                                 // 130
      setCurrentComputation(previous);                                          // 131
      inCompute = false;                                                        // 132
    }                                                                           // 133
  },                                                                            // 134
                                                                                // 135
  _recompute: function () {                                                     // 136
    var self = this;                                                            // 137
                                                                                // 138
    self._recomputing = true;                                                   // 139
    while (self.invalidated && ! self.stopped) {                                // 140
      try {                                                                     // 141
        self._compute();                                                        // 142
      } catch (e) {                                                             // 143
        _debugFunc()("Exception from Deps recompute:", e.stack || e.message);   // 144
      }                                                                         // 145
      // If _compute() invalidated us, we run again immediately.                // 146
      // A computation that invalidates itself indefinitely is an               // 147
      // infinite loop, of course.                                              // 148
      //                                                                        // 149
      // We could put an iteration counter here and catch run-away              // 150
      // loops.                                                                 // 151
    }                                                                           // 152
    self._recomputing = false;                                                  // 153
  }                                                                             // 154
});                                                                             // 155
                                                                                // 156
Deps.Dependency = function () {                                                 // 157
  this._dependentsById = {};                                                    // 158
};                                                                              // 159
                                                                                // 160
_.extend(Deps.Dependency.prototype, {                                           // 161
  // Adds `computation` to this set if it is not already                        // 162
  // present.  Returns true if `computation` is a new member of the set.        // 163
  // If no argument, defaults to currentComputation, or does nothing            // 164
  // if there is no currentComputation.                                         // 165
  depend: function (computation) {                                              // 166
    if (! computation) {                                                        // 167
      if (! Deps.active)                                                        // 168
        return false;                                                           // 169
                                                                                // 170
      computation = Deps.currentComputation;                                    // 171
    }                                                                           // 172
    var self = this;                                                            // 173
    var id = computation._id;                                                   // 174
    if (! (id in self._dependentsById)) {                                       // 175
      self._dependentsById[id] = computation;                                   // 176
      computation.onInvalidate(function () {                                    // 177
        delete self._dependentsById[id];                                        // 178
      });                                                                       // 179
      return true;                                                              // 180
    }                                                                           // 181
    return false;                                                               // 182
  },                                                                            // 183
  changed: function () {                                                        // 184
    var self = this;                                                            // 185
    for (var id in self._dependentsById)                                        // 186
      self._dependentsById[id].invalidate();                                    // 187
  },                                                                            // 188
  hasDependents: function () {                                                  // 189
    var self = this;                                                            // 190
    for(var id in self._dependentsById)                                         // 191
      return true;                                                              // 192
    return false;                                                               // 193
  }                                                                             // 194
});                                                                             // 195
                                                                                // 196
_.extend(Deps, {                                                                // 197
  flush: function () {                                                          // 198
    // Nested flush could plausibly happen if, say, a flush causes              // 199
    // DOM mutation, which causes a "blur" event, which runs an                 // 200
    // app event handler that calls Deps.flush.  At the moment                  // 201
    // Spark blocks event handlers during DOM mutation anyway,                  // 202
    // because the LiveRange tree isn't valid.  And we don't have               // 203
    // any useful notion of a nested flush.                                     // 204
    //                                                                          // 205
    // https://app.asana.com/0/159908330244/385138233856                        // 206
    if (inFlush)                                                                // 207
      throw new Error("Can't call Deps.flush while flushing");                  // 208
                                                                                // 209
    if (inCompute)                                                              // 210
      throw new Error("Can't flush inside Deps.autorun");                       // 211
                                                                                // 212
    inFlush = true;                                                             // 213
    willFlush = true;                                                           // 214
                                                                                // 215
    while (pendingComputations.length ||                                        // 216
           afterFlushCallbacks.length) {                                        // 217
                                                                                // 218
      // recompute all pending computations                                     // 219
      var comps = pendingComputations;                                          // 220
      pendingComputations = [];                                                 // 221
                                                                                // 222
      for (var i = 0, comp; comp = comps[i]; i++)                               // 223
        comp._recompute();                                                      // 224
                                                                                // 225
      if (afterFlushCallbacks.length) {                                         // 226
        // call one afterFlush callback, which may                              // 227
        // invalidate more computations                                         // 228
        var func = afterFlushCallbacks.shift();                                 // 229
        try {                                                                   // 230
          func();                                                               // 231
        } catch (e) {                                                           // 232
          _debugFunc()("Exception from Deps afterFlush function:",              // 233
                       e.stack || e.message);                                   // 234
        }                                                                       // 235
      }                                                                         // 236
    }                                                                           // 237
                                                                                // 238
    inFlush = false;                                                            // 239
    willFlush = false;                                                          // 240
  },                                                                            // 241
                                                                                // 242
  // Run f(). Record its dependencies. Rerun it whenever the                    // 243
  // dependencies change.                                                       // 244
  //                                                                            // 245
  // Returns a new Computation, which is also passed to f.                      // 246
  //                                                                            // 247
  // Links the computation to the current computation                           // 248
  // so that it is stopped if the current computation is invalidated.           // 249
  autorun: function (f) {                                                       // 250
    if (typeof f !== 'function')                                                // 251
      throw new Error('Deps.autorun requires a function argument');             // 252
                                                                                // 253
    constructingComputation = true;                                             // 254
    var c = new Deps.Computation(f, Deps.currentComputation);                   // 255
                                                                                // 256
    if (Deps.active)                                                            // 257
      Deps.onInvalidate(function () {                                           // 258
        c.stop();                                                               // 259
      });                                                                       // 260
                                                                                // 261
    return c;                                                                   // 262
  },                                                                            // 263
                                                                                // 264
  // Run `f` with no current computation, returning the return value            // 265
  // of `f`.  Used to turn off reactivity for the duration of `f`,              // 266
  // so that reactive data sources accessed by `f` will not result in any       // 267
  // computations being invalidated.                                            // 268
  nonreactive: function (f) {                                                   // 269
    var previous = Deps.currentComputation;                                     // 270
    setCurrentComputation(null);                                                // 271
    try {                                                                       // 272
      return f();                                                               // 273
    } finally {                                                                 // 274
      setCurrentComputation(previous);                                          // 275
    }                                                                           // 276
  },                                                                            // 277
                                                                                // 278
  // Wrap `f` so that it is always run nonreactively.                           // 279
  _makeNonreactive: function (f) {                                              // 280
    if (f.$isNonreactive) // avoid multiple layers of wrapping.                 // 281
      return f;                                                                 // 282
    var nonreactiveVersion = function (/*arguments*/) {                         // 283
      var self = this;                                                          // 284
      var args = _.toArray(arguments);                                          // 285
      var ret;                                                                  // 286
      Deps.nonreactive(function () {                                            // 287
        ret = f.apply(self, args);                                              // 288
      });                                                                       // 289
      return ret;                                                               // 290
    };                                                                          // 291
    nonreactiveVersion.$isNonreactive = true;                                   // 292
    return nonreactiveVersion;                                                  // 293
  },                                                                            // 294
                                                                                // 295
  onInvalidate: function (f) {                                                  // 296
    if (! Deps.active)                                                          // 297
      throw new Error("Deps.onInvalidate requires a currentComputation");       // 298
                                                                                // 299
    Deps.currentComputation.onInvalidate(f);                                    // 300
  },                                                                            // 301
                                                                                // 302
  afterFlush: function (f) {                                                    // 303
    afterFlushCallbacks.push(f);                                                // 304
    requireFlush();                                                             // 305
  }                                                                             // 306
});                                                                             // 307
                                                                                // 308
//////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////
//                                                                              //
// packages/deps/deprecated.js                                                  //
//                                                                              //
//////////////////////////////////////////////////////////////////////////////////
                                                                                //
// Deprecated (Deps-recated?) functions.                                        // 1
                                                                                // 2
// These functions used to be on the Meteor object (and worked slightly         // 3
// differently).                                                                // 4
// XXX COMPAT WITH 0.5.7                                                        // 5
Meteor.flush = Deps.flush;                                                      // 6
Meteor.autorun = Deps.autorun;                                                  // 7
                                                                                // 8
// We used to require a special "autosubscribe" call to reactively subscribe to // 9
// things. Now, it works with autorun.                                          // 10
// XXX COMPAT WITH 0.5.4                                                        // 11
Meteor.autosubscribe = Deps.autorun;                                            // 12
                                                                                // 13
// This Deps API briefly existed in 0.5.8 and 0.5.9                             // 14
// XXX COMPAT WITH 0.5.9                                                        // 15
Deps.depend = function (d) {                                                    // 16
  return d.depend();                                                            // 17
};                                                                              // 18
                                                                                // 19
//////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.deps = {
  Deps: Deps
};

})();
