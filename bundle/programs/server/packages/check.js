(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;
var EJSON = Package.ejson.EJSON;

/* Package-scope variables */
var check, Match;

(function () {

///////////////////////////////////////////////////////////////////////////////////
//                                                                               //
// packages/check/match.js                                                       //
//                                                                               //
///////////////////////////////////////////////////////////////////////////////////
                                                                                 //
// XXX docs                                                                      // 1
                                                                                 // 2
// Things we explicitly do NOT support:                                          // 3
//    - heterogenous arrays                                                      // 4
                                                                                 // 5
var currentArgumentChecker = new Meteor.EnvironmentVariable;                     // 6
                                                                                 // 7
check = function (value, pattern) {                                              // 8
  // Record that check got called, if somebody cared.                            // 9
  var argChecker = currentArgumentChecker.get();                                 // 10
  if (argChecker)                                                                // 11
    argChecker.checking(value);                                                  // 12
  try {                                                                          // 13
    checkSubtree(value, pattern);                                                // 14
  } catch (err) {                                                                // 15
    if ((err instanceof Match.Error) && err.path)                                // 16
      err.message += " in field " + err.path;                                    // 17
    throw err;                                                                   // 18
  }                                                                              // 19
};                                                                               // 20
                                                                                 // 21
Match = {                                                                        // 22
  Optional: function (pattern) {                                                 // 23
    return new Optional(pattern);                                                // 24
  },                                                                             // 25
  OneOf: function (/*arguments*/) {                                              // 26
    return new OneOf(_.toArray(arguments));                                      // 27
  },                                                                             // 28
  Any: ['__any__'],                                                              // 29
  Where: function (condition) {                                                  // 30
    return new Where(condition);                                                 // 31
  },                                                                             // 32
  ObjectIncluding: function (pattern) {                                          // 33
    return new ObjectIncluding(pattern);                                         // 34
  },                                                                             // 35
  // Matches only signed 32-bit integers                                         // 36
  Integer: ['__integer__'],                                                      // 37
                                                                                 // 38
  // XXX matchers should know how to describe themselves for errors              // 39
  Error: Meteor.makeErrorType("Match.Error", function (msg) {                    // 40
    this.message = "Match error: " + msg;                                        // 41
    // The path of the value that failed to match. Initially empty, this gets    // 42
    // populated by catching and rethrowing the exception as it goes back up the // 43
    // stack.                                                                    // 44
    // E.g.: "vals[3].entity.created"                                            // 45
    this.path = "";                                                              // 46
    // If this gets sent over DDP, don't give full internal details but at least // 47
    // provide something better than 500 Internal server error.                  // 48
    this.sanitizedError = new Meteor.Error(400, "Match failed");                 // 49
  }),                                                                            // 50
                                                                                 // 51
  // Tests to see if value matches pattern. Unlike check, it merely returns true // 52
  // or false (unless an error other than Match.Error was thrown). It does not   // 53
  // interact with _failIfArgumentsAreNotAllChecked.                             // 54
  // XXX maybe also implement a Match.match which returns more information about // 55
  //     failures but without using exception handling or doing what check()     // 56
  //     does with _failIfArgumentsAreNotAllChecked and Meteor.Error conversion  // 57
  test: function (value, pattern) {                                              // 58
    try {                                                                        // 59
      checkSubtree(value, pattern);                                              // 60
      return true;                                                               // 61
    } catch (e) {                                                                // 62
      if (e instanceof Match.Error)                                              // 63
        return false;                                                            // 64
      // Rethrow other errors.                                                   // 65
      throw e;                                                                   // 66
    }                                                                            // 67
  },                                                                             // 68
                                                                                 // 69
  // Runs `f.apply(context, args)`. If check() is not called on every element of // 70
  // `args` (either directly or in the first level of an array), throws an error // 71
  // (using `description` in the message).                                       // 72
  //                                                                             // 73
  _failIfArgumentsAreNotAllChecked: function (f, context, args, description) {   // 74
    var argChecker = new ArgumentChecker(args, description);                     // 75
    var result = currentArgumentChecker.withValue(argChecker, function () {      // 76
      return f.apply(context, args);                                             // 77
    });                                                                          // 78
    // If f didn't itself throw, make sure it checked all of its arguments.      // 79
    argChecker.throwUnlessAllArgumentsHaveBeenChecked();                         // 80
    return result;                                                               // 81
  }                                                                              // 82
};                                                                               // 83
                                                                                 // 84
var Optional = function (pattern) {                                              // 85
  this.pattern = pattern;                                                        // 86
};                                                                               // 87
                                                                                 // 88
var OneOf = function (choices) {                                                 // 89
  if (_.isEmpty(choices))                                                        // 90
    throw new Error("Must provide at least one choice to Match.OneOf");          // 91
  this.choices = choices;                                                        // 92
};                                                                               // 93
                                                                                 // 94
var Where = function (condition) {                                               // 95
  this.condition = condition;                                                    // 96
};                                                                               // 97
                                                                                 // 98
var ObjectIncluding = function (pattern) {                                       // 99
  this.pattern = pattern;                                                        // 100
};                                                                               // 101
                                                                                 // 102
var typeofChecks = [                                                             // 103
  [String, "string"],                                                            // 104
  [Number, "number"],                                                            // 105
  [Boolean, "boolean"],                                                          // 106
  // While we don't allow undefined in EJSON, this is good for optional          // 107
  // arguments with OneOf.                                                       // 108
  [undefined, "undefined"]                                                       // 109
];                                                                               // 110
                                                                                 // 111
var checkSubtree = function (value, pattern) {                                   // 112
  // Match anything!                                                             // 113
  if (pattern === Match.Any)                                                     // 114
    return;                                                                      // 115
                                                                                 // 116
  // Basic atomic types.                                                         // 117
  // Do not match boxed objects (e.g. String, Boolean)                           // 118
  for (var i = 0; i < typeofChecks.length; ++i) {                                // 119
    if (pattern === typeofChecks[i][0]) {                                        // 120
      if (typeof value === typeofChecks[i][1])                                   // 121
        return;                                                                  // 122
      throw new Match.Error("Expected " + typeofChecks[i][1] + ", got " +        // 123
                            typeof value);                                       // 124
    }                                                                            // 125
  }                                                                              // 126
  if (pattern === null) {                                                        // 127
    if (value === null)                                                          // 128
      return;                                                                    // 129
    throw new Match.Error("Expected null, got " + EJSON.stringify(value));       // 130
  }                                                                              // 131
                                                                                 // 132
  // Match.Integer is special type encoded with array                            // 133
  if (pattern === Match.Integer) {                                               // 134
    // There is no consistent and reliable way to check if variable is a 64-bit  // 135
    // integer. One of the popular solutions is to get reminder of division by 1 // 136
    // but this method fails on really large floats with big precision.          // 137
    // E.g.: 1.348192308491824e+23 % 1 === 0 in V8                               // 138
    // Bitwise operators work consistantly but always cast variable to 32-bit    // 139
    // signed integer according to JavaScript specs.                             // 140
    if (typeof value === "number" && (value | 0) === value)                      // 141
      return                                                                     // 142
    throw new Match.Error("Expected Integer, got "                               // 143
                + (value instanceof Object ? EJSON.stringify(value) : value));   // 144
  }                                                                              // 145
                                                                                 // 146
  // "Object" is shorthand for Match.ObjectIncluding({});                        // 147
  if (pattern === Object)                                                        // 148
    pattern = Match.ObjectIncluding({});                                         // 149
                                                                                 // 150
  // Array (checked AFTER Any, which is implemented as an Array).                // 151
  if (pattern instanceof Array) {                                                // 152
    if (pattern.length !== 1)                                                    // 153
      throw Error("Bad pattern: arrays must have one type element" +             // 154
                  EJSON.stringify(pattern));                                     // 155
    if (!_.isArray(value) && !_.isArguments(value)) {                            // 156
      throw new Match.Error("Expected array, got " + EJSON.stringify(value));    // 157
    }                                                                            // 158
                                                                                 // 159
    _.each(value, function (valueElement, index) {                               // 160
      try {                                                                      // 161
        checkSubtree(valueElement, pattern[0]);                                  // 162
      } catch (err) {                                                            // 163
        if (err instanceof Match.Error) {                                        // 164
          err.path = _prependPath(index, err.path);                              // 165
        }                                                                        // 166
        throw err;                                                               // 167
      }                                                                          // 168
    });                                                                          // 169
    return;                                                                      // 170
  }                                                                              // 171
                                                                                 // 172
  // Arbitrary validation checks. The condition can return false or throw a      // 173
  // Match.Error (ie, it can internally use check()) to fail.                    // 174
  if (pattern instanceof Where) {                                                // 175
    if (pattern.condition(value))                                                // 176
      return;                                                                    // 177
    // XXX this error is terrible                                                // 178
    throw new Match.Error("Failed Match.Where validation");                      // 179
  }                                                                              // 180
                                                                                 // 181
                                                                                 // 182
  if (pattern instanceof Optional)                                               // 183
    pattern = Match.OneOf(undefined, pattern.pattern);                           // 184
                                                                                 // 185
  if (pattern instanceof OneOf) {                                                // 186
    for (var i = 0; i < pattern.choices.length; ++i) {                           // 187
      try {                                                                      // 188
        checkSubtree(value, pattern.choices[i]);                                 // 189
        // No error? Yay, return.                                                // 190
        return;                                                                  // 191
      } catch (err) {                                                            // 192
        // Other errors should be thrown. Match errors just mean try another     // 193
        // choice.                                                               // 194
        if (!(err instanceof Match.Error))                                       // 195
          throw err;                                                             // 196
      }                                                                          // 197
    }                                                                            // 198
    // XXX this error is terrible                                                // 199
    throw new Match.Error("Failed Match.OneOf or Match.Optional validation");    // 200
  }                                                                              // 201
                                                                                 // 202
  // A function that isn't something we special-case is assumed to be a          // 203
  // constructor.                                                                // 204
  if (pattern instanceof Function) {                                             // 205
    if (value instanceof pattern)                                                // 206
      return;                                                                    // 207
    // XXX what if .name isn't defined                                           // 208
    throw new Match.Error("Expected " + pattern.name);                           // 209
  }                                                                              // 210
                                                                                 // 211
  var unknownKeysAllowed = false;                                                // 212
  if (pattern instanceof ObjectIncluding) {                                      // 213
    unknownKeysAllowed = true;                                                   // 214
    pattern = pattern.pattern;                                                   // 215
  }                                                                              // 216
                                                                                 // 217
  if (typeof pattern !== "object")                                               // 218
    throw Error("Bad pattern: unknown pattern type");                            // 219
                                                                                 // 220
  // An object, with required and optional keys. Note that this does NOT do      // 221
  // structural matches against objects of special types that happen to match    // 222
  // the pattern: this really needs to be a plain old {Object}!                  // 223
  if (typeof value !== 'object')                                                 // 224
    throw new Match.Error("Expected object, got " + typeof value);               // 225
  if (value === null)                                                            // 226
    throw new Match.Error("Expected object, got null");                          // 227
  if (value.constructor !== Object)                                              // 228
    throw new Match.Error("Expected plain object");                              // 229
                                                                                 // 230
  var requiredPatterns = {};                                                     // 231
  var optionalPatterns = {};                                                     // 232
  _.each(pattern, function (subPattern, key) {                                   // 233
    if (subPattern instanceof Optional)                                          // 234
      optionalPatterns[key] = subPattern.pattern;                                // 235
    else                                                                         // 236
      requiredPatterns[key] = subPattern;                                        // 237
  });                                                                            // 238
                                                                                 // 239
  _.each(value, function (subValue, key) {                                       // 240
    try {                                                                        // 241
      if (_.has(requiredPatterns, key)) {                                        // 242
        checkSubtree(subValue, requiredPatterns[key]);                           // 243
        delete requiredPatterns[key];                                            // 244
      } else if (_.has(optionalPatterns, key)) {                                 // 245
        checkSubtree(subValue, optionalPatterns[key]);                           // 246
      } else {                                                                   // 247
        if (!unknownKeysAllowed)                                                 // 248
          throw new Match.Error("Unknown key");                                  // 249
      }                                                                          // 250
    } catch (err) {                                                              // 251
      if (err instanceof Match.Error)                                            // 252
        err.path = _prependPath(key, err.path);                                  // 253
      throw err;                                                                 // 254
    }                                                                            // 255
  });                                                                            // 256
                                                                                 // 257
  _.each(requiredPatterns, function (subPattern, key) {                          // 258
    throw new Match.Error("Missing key '" + key + "'");                          // 259
  });                                                                            // 260
};                                                                               // 261
                                                                                 // 262
var ArgumentChecker = function (args, description) {                             // 263
  var self = this;                                                               // 264
  // Make a SHALLOW copy of the arguments. (We'll be doing identity checks       // 265
  // against its contents.)                                                      // 266
  self.args = _.clone(args);                                                     // 267
  // Since the common case will be to check arguments in order, and we splice    // 268
  // out arguments when we check them, make it so we splice out from the end     // 269
  // rather than the beginning.                                                  // 270
  self.args.reverse();                                                           // 271
  self.description = description;                                                // 272
};                                                                               // 273
                                                                                 // 274
_.extend(ArgumentChecker.prototype, {                                            // 275
  checking: function (value) {                                                   // 276
    var self = this;                                                             // 277
    if (self._checkingOneValue(value))                                           // 278
      return;                                                                    // 279
    // Allow check(arguments, [String]) or check(arguments.slice(1), [String])   // 280
    // or check([foo, bar], [String]) to count... but only if value wasn't       // 281
    // itself an argument.                                                       // 282
    if (_.isArray(value) || _.isArguments(value)) {                              // 283
      _.each(value, _.bind(self._checkingOneValue, self));                       // 284
    }                                                                            // 285
  },                                                                             // 286
  _checkingOneValue: function (value) {                                          // 287
    var self = this;                                                             // 288
    for (var i = 0; i < self.args.length; ++i) {                                 // 289
      // Is this value one of the arguments? (This can have a false positive if  // 290
      // the argument is an interned primitive, but it's still a good enough     // 291
      // check.)                                                                 // 292
      if (value === self.args[i]) {                                              // 293
        self.args.splice(i, 1);                                                  // 294
        return true;                                                             // 295
      }                                                                          // 296
    }                                                                            // 297
    return false;                                                                // 298
  },                                                                             // 299
  throwUnlessAllArgumentsHaveBeenChecked: function () {                          // 300
    var self = this;                                                             // 301
    if (!_.isEmpty(self.args))                                                   // 302
      throw new Error("Did not check() all arguments during " +                  // 303
                      self.description);                                         // 304
  }                                                                              // 305
});                                                                              // 306
                                                                                 // 307
var _jsKeywords = ["do", "if", "in", "for", "let", "new", "try", "var", "case",  // 308
  "else", "enum", "eval", "false", "null", "this", "true", "void", "with",       // 309
  "break", "catch", "class", "const", "super", "throw", "while", "yield",        // 310
  "delete", "export", "import", "public", "return", "static", "switch",          // 311
  "typeof", "default", "extends", "finally", "package", "private", "continue",   // 312
  "debugger", "function", "arguments", "interface", "protected", "implements",   // 313
  "instanceof"];                                                                 // 314
                                                                                 // 315
// Assumes the base of path is already escaped properly                          // 316
// returns key + base                                                            // 317
var _prependPath = function (key, base) {                                        // 318
  if ((typeof key) === "number" || key.match(/^[0-9]+$/))                        // 319
    key = "[" + key + "]";                                                       // 320
  else if (!key.match(/^[a-z_$][0-9a-z_$]*$/i) || _.contains(_jsKeywords, key))  // 321
    key = JSON.stringify([key]);                                                 // 322
                                                                                 // 323
  if (base && base[0] !== "[")                                                   // 324
    return key + '.' + base;                                                     // 325
  return key + base;                                                             // 326
};                                                                               // 327
                                                                                 // 328
                                                                                 // 329
///////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.check = {
  check: check,
  Match: Match
};

})();
