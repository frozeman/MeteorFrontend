(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;

/* Package-scope variables */
var EJSON, EJSONTest, base64Encode, base64Decode;

(function () {

//////////////////////////////////////////////////////////////////////////////////////////
//                                                                                      //
// packages/ejson/ejson.js                                                              //
//                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////
                                                                                        //
EJSON = {};                                                                             // 1
EJSONTest = {};                                                                         // 2
                                                                                        // 3
var customTypes = {};                                                                   // 4
// Add a custom type, using a method of your choice to get to and                       // 5
// from a basic JSON-able representation.  The factory argument                         // 6
// is a function of JSON-able --> your object                                           // 7
// The type you add must have:                                                          // 8
// - A clone() method, so that Meteor can deep-copy it when necessary.                  // 9
// - A equals() method, so that Meteor can compare it                                   // 10
// - A toJSONValue() method, so that Meteor can serialize it                            // 11
// - a typeName() method, to show how to look it up in our type table.                  // 12
// It is okay if these methods are monkey-patched on.                                   // 13
//                                                                                      // 14
EJSON.addType = function (name, factory) {                                              // 15
  if (_.has(customTypes, name))                                                         // 16
    throw new Error("Type " + name + " already present");                               // 17
  customTypes[name] = factory;                                                          // 18
};                                                                                      // 19
                                                                                        // 20
var builtinConverters = [                                                               // 21
  { // Date                                                                             // 22
    matchJSONValue: function (obj) {                                                    // 23
      return _.has(obj, '$date') && _.size(obj) === 1;                                  // 24
    },                                                                                  // 25
    matchObject: function (obj) {                                                       // 26
      return obj instanceof Date;                                                       // 27
    },                                                                                  // 28
    toJSONValue: function (obj) {                                                       // 29
      return {$date: obj.getTime()};                                                    // 30
    },                                                                                  // 31
    fromJSONValue: function (obj) {                                                     // 32
      return new Date(obj.$date);                                                       // 33
    }                                                                                   // 34
  },                                                                                    // 35
  { // Binary                                                                           // 36
    matchJSONValue: function (obj) {                                                    // 37
      return _.has(obj, '$binary') && _.size(obj) === 1;                                // 38
    },                                                                                  // 39
    matchObject: function (obj) {                                                       // 40
      return typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array             // 41
        || (obj && _.has(obj, '$Uint8ArrayPolyfill'));                                  // 42
    },                                                                                  // 43
    toJSONValue: function (obj) {                                                       // 44
      return {$binary: base64Encode(obj)};                                              // 45
    },                                                                                  // 46
    fromJSONValue: function (obj) {                                                     // 47
      return base64Decode(obj.$binary);                                                 // 48
    }                                                                                   // 49
  },                                                                                    // 50
  { // Escaping one level                                                               // 51
    matchJSONValue: function (obj) {                                                    // 52
      return _.has(obj, '$escape') && _.size(obj) === 1;                                // 53
    },                                                                                  // 54
    matchObject: function (obj) {                                                       // 55
      if (_.isEmpty(obj) || _.size(obj) > 2) {                                          // 56
        return false;                                                                   // 57
      }                                                                                 // 58
      return _.any(builtinConverters, function (converter) {                            // 59
        return converter.matchJSONValue(obj);                                           // 60
      });                                                                               // 61
    },                                                                                  // 62
    toJSONValue: function (obj) {                                                       // 63
      var newObj = {};                                                                  // 64
      _.each(obj, function (value, key) {                                               // 65
        newObj[key] = EJSON.toJSONValue(value);                                         // 66
      });                                                                               // 67
      return {$escape: newObj};                                                         // 68
    },                                                                                  // 69
    fromJSONValue: function (obj) {                                                     // 70
      var newObj = {};                                                                  // 71
      _.each(obj.$escape, function (value, key) {                                       // 72
        newObj[key] = EJSON.fromJSONValue(value);                                       // 73
      });                                                                               // 74
      return newObj;                                                                    // 75
    }                                                                                   // 76
  },                                                                                    // 77
  { // Custom                                                                           // 78
    matchJSONValue: function (obj) {                                                    // 79
      return _.has(obj, '$type') && _.has(obj, '$value') && _.size(obj) === 2;          // 80
    },                                                                                  // 81
    matchObject: function (obj) {                                                       // 82
      return EJSON._isCustomType(obj);                                                  // 83
    },                                                                                  // 84
    toJSONValue: function (obj) {                                                       // 85
      return {$type: obj.typeName(), $value: obj.toJSONValue()};                        // 86
    },                                                                                  // 87
    fromJSONValue: function (obj) {                                                     // 88
      var typeName = obj.$type;                                                         // 89
      var converter = customTypes[typeName];                                            // 90
      return converter(obj.$value);                                                     // 91
    }                                                                                   // 92
  }                                                                                     // 93
];                                                                                      // 94
                                                                                        // 95
EJSON._isCustomType = function (obj) {                                                  // 96
  return obj &&                                                                         // 97
    typeof obj.toJSONValue === 'function' &&                                            // 98
    typeof obj.typeName === 'function' &&                                               // 99
    _.has(customTypes, obj.typeName());                                                 // 100
};                                                                                      // 101
                                                                                        // 102
                                                                                        // 103
// for both arrays and objects, in-place modification.                                  // 104
var adjustTypesToJSONValue =                                                            // 105
EJSON._adjustTypesToJSONValue = function (obj) {                                        // 106
  if (obj === null)                                                                     // 107
    return null;                                                                        // 108
  var maybeChanged = toJSONValueHelper(obj);                                            // 109
  if (maybeChanged !== undefined)                                                       // 110
    return maybeChanged;                                                                // 111
  _.each(obj, function (value, key) {                                                   // 112
    if (typeof value !== 'object' && value !== undefined)                               // 113
      return; // continue                                                               // 114
    var changed = toJSONValueHelper(value);                                             // 115
    if (changed) {                                                                      // 116
      obj[key] = changed;                                                               // 117
      return; // on to the next key                                                     // 118
    }                                                                                   // 119
    // if we get here, value is an object but not adjustable                            // 120
    // at this level.  recurse.                                                         // 121
    adjustTypesToJSONValue(value);                                                      // 122
  });                                                                                   // 123
  return obj;                                                                           // 124
};                                                                                      // 125
                                                                                        // 126
// Either return the JSON-compatible version of the argument, or undefined (if          // 127
// the item isn't itself replaceable, but maybe some fields in it are)                  // 128
var toJSONValueHelper = function (item) {                                               // 129
  for (var i = 0; i < builtinConverters.length; i++) {                                  // 130
    var converter = builtinConverters[i];                                               // 131
    if (converter.matchObject(item)) {                                                  // 132
      return converter.toJSONValue(item);                                               // 133
    }                                                                                   // 134
  }                                                                                     // 135
  return undefined;                                                                     // 136
};                                                                                      // 137
                                                                                        // 138
EJSON.toJSONValue = function (item) {                                                   // 139
  var changed = toJSONValueHelper(item);                                                // 140
  if (changed !== undefined)                                                            // 141
    return changed;                                                                     // 142
  if (typeof item === 'object') {                                                       // 143
    item = EJSON.clone(item);                                                           // 144
    adjustTypesToJSONValue(item);                                                       // 145
  }                                                                                     // 146
  return item;                                                                          // 147
};                                                                                      // 148
                                                                                        // 149
// for both arrays and objects. Tries its best to just                                  // 150
// use the object you hand it, but may return something                                 // 151
// different if the object you hand it itself needs changing.                           // 152
//                                                                                      // 153
var adjustTypesFromJSONValue =                                                          // 154
EJSON._adjustTypesFromJSONValue = function (obj) {                                      // 155
  if (obj === null)                                                                     // 156
    return null;                                                                        // 157
  var maybeChanged = fromJSONValueHelper(obj);                                          // 158
  if (maybeChanged !== obj)                                                             // 159
    return maybeChanged;                                                                // 160
  _.each(obj, function (value, key) {                                                   // 161
    if (typeof value === 'object') {                                                    // 162
      var changed = fromJSONValueHelper(value);                                         // 163
      if (value !== changed) {                                                          // 164
        obj[key] = changed;                                                             // 165
        return;                                                                         // 166
      }                                                                                 // 167
      // if we get here, value is an object but not adjustable                          // 168
      // at this level.  recurse.                                                       // 169
      adjustTypesFromJSONValue(value);                                                  // 170
    }                                                                                   // 171
  });                                                                                   // 172
  return obj;                                                                           // 173
};                                                                                      // 174
                                                                                        // 175
// Either return the argument changed to have the non-json                              // 176
// rep of itself (the Object version) or the argument itself.                           // 177
                                                                                        // 178
// DOES NOT RECURSE.  For actually getting the fully-changed value, use                 // 179
// EJSON.fromJSONValue                                                                  // 180
var fromJSONValueHelper = function (value) {                                            // 181
  if (typeof value === 'object' && value !== null) {                                    // 182
    if (_.size(value) <= 2                                                              // 183
        && _.all(value, function (v, k) {                                               // 184
          return typeof k === 'string' && k.substr(0, 1) === '$';                       // 185
        })) {                                                                           // 186
      for (var i = 0; i < builtinConverters.length; i++) {                              // 187
        var converter = builtinConverters[i];                                           // 188
        if (converter.matchJSONValue(value)) {                                          // 189
          return converter.fromJSONValue(value);                                        // 190
        }                                                                               // 191
      }                                                                                 // 192
    }                                                                                   // 193
  }                                                                                     // 194
  return value;                                                                         // 195
};                                                                                      // 196
                                                                                        // 197
EJSON.fromJSONValue = function (item) {                                                 // 198
  var changed = fromJSONValueHelper(item);                                              // 199
  if (changed === item && typeof item === 'object') {                                   // 200
    item = EJSON.clone(item);                                                           // 201
    adjustTypesFromJSONValue(item);                                                     // 202
    return item;                                                                        // 203
  } else {                                                                              // 204
    return changed;                                                                     // 205
  }                                                                                     // 206
};                                                                                      // 207
                                                                                        // 208
EJSON.stringify = function (item) {                                                     // 209
  return JSON.stringify(EJSON.toJSONValue(item));                                       // 210
};                                                                                      // 211
                                                                                        // 212
EJSON.parse = function (item) {                                                         // 213
  return EJSON.fromJSONValue(JSON.parse(item));                                         // 214
};                                                                                      // 215
                                                                                        // 216
EJSON.isBinary = function (obj) {                                                       // 217
  return !!((typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array) ||         // 218
    (obj && obj.$Uint8ArrayPolyfill));                                                  // 219
};                                                                                      // 220
                                                                                        // 221
EJSON.equals = function (a, b, options) {                                               // 222
  var i;                                                                                // 223
  var keyOrderSensitive = !!(options && options.keyOrderSensitive);                     // 224
  if (a === b)                                                                          // 225
    return true;                                                                        // 226
  if (!a || !b) // if either one is falsy, they'd have to be === to be equal            // 227
    return false;                                                                       // 228
  if (!(typeof a === 'object' && typeof b === 'object'))                                // 229
    return false;                                                                       // 230
  if (a instanceof Date && b instanceof Date)                                           // 231
    return a.valueOf() === b.valueOf();                                                 // 232
  if (EJSON.isBinary(a) && EJSON.isBinary(b)) {                                         // 233
    if (a.length !== b.length)                                                          // 234
      return false;                                                                     // 235
    for (i = 0; i < a.length; i++) {                                                    // 236
      if (a[i] !== b[i])                                                                // 237
        return false;                                                                   // 238
    }                                                                                   // 239
    return true;                                                                        // 240
  }                                                                                     // 241
  if (typeof (a.equals) === 'function')                                                 // 242
    return a.equals(b, options);                                                        // 243
  if (a instanceof Array) {                                                             // 244
    if (!(b instanceof Array))                                                          // 245
      return false;                                                                     // 246
    if (a.length !== b.length)                                                          // 247
      return false;                                                                     // 248
    for (i = 0; i < a.length; i++) {                                                    // 249
      if (!EJSON.equals(a[i], b[i], options))                                           // 250
        return false;                                                                   // 251
    }                                                                                   // 252
    return true;                                                                        // 253
  }                                                                                     // 254
  // fall back to structural equality of objects                                        // 255
  var ret;                                                                              // 256
  if (keyOrderSensitive) {                                                              // 257
    var bKeys = [];                                                                     // 258
    _.each(b, function (val, x) {                                                       // 259
        bKeys.push(x);                                                                  // 260
    });                                                                                 // 261
    i = 0;                                                                              // 262
    ret = _.all(a, function (val, x) {                                                  // 263
      if (i >= bKeys.length) {                                                          // 264
        return false;                                                                   // 265
      }                                                                                 // 266
      if (x !== bKeys[i]) {                                                             // 267
        return false;                                                                   // 268
      }                                                                                 // 269
      if (!EJSON.equals(val, b[bKeys[i]], options)) {                                   // 270
        return false;                                                                   // 271
      }                                                                                 // 272
      i++;                                                                              // 273
      return true;                                                                      // 274
    });                                                                                 // 275
    return ret && i === bKeys.length;                                                   // 276
  } else {                                                                              // 277
    i = 0;                                                                              // 278
    ret = _.all(a, function (val, key) {                                                // 279
      if (!_.has(b, key)) {                                                             // 280
        return false;                                                                   // 281
      }                                                                                 // 282
      if (!EJSON.equals(val, b[key], options)) {                                        // 283
        return false;                                                                   // 284
      }                                                                                 // 285
      i++;                                                                              // 286
      return true;                                                                      // 287
    });                                                                                 // 288
    return ret && _.size(b) === i;                                                      // 289
  }                                                                                     // 290
};                                                                                      // 291
                                                                                        // 292
EJSON.clone = function (v) {                                                            // 293
  var ret;                                                                              // 294
  if (typeof v !== "object")                                                            // 295
    return v;                                                                           // 296
  if (v === null)                                                                       // 297
    return null; // null has typeof "object"                                            // 298
  if (v instanceof Date)                                                                // 299
    return new Date(v.getTime());                                                       // 300
  if (EJSON.isBinary(v)) {                                                              // 301
    ret = EJSON.newBinary(v.length);                                                    // 302
    for (var i = 0; i < v.length; i++) {                                                // 303
      ret[i] = v[i];                                                                    // 304
    }                                                                                   // 305
    return ret;                                                                         // 306
  }                                                                                     // 307
  if (_.isArray(v) || _.isArguments(v)) {                                               // 308
    // For some reason, _.map doesn't work in this context on Opera (weird test         // 309
    // failures).                                                                       // 310
    ret = [];                                                                           // 311
    for (i = 0; i < v.length; i++)                                                      // 312
      ret[i] = EJSON.clone(v[i]);                                                       // 313
    return ret;                                                                         // 314
  }                                                                                     // 315
  // handle general user-defined typed Objects if they have a clone method              // 316
  if (typeof v.clone === 'function') {                                                  // 317
    return v.clone();                                                                   // 318
  }                                                                                     // 319
  // handle other objects                                                               // 320
  ret = {};                                                                             // 321
  _.each(v, function (value, key) {                                                     // 322
    ret[key] = EJSON.clone(value);                                                      // 323
  });                                                                                   // 324
  return ret;                                                                           // 325
};                                                                                      // 326
                                                                                        // 327
//////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////////
//                                                                                      //
// packages/ejson/base64.js                                                             //
//                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////
                                                                                        //
// Base 64 encoding                                                                     // 1
                                                                                        // 2
var BASE_64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; // 3
                                                                                        // 4
var BASE_64_VALS = {};                                                                  // 5
                                                                                        // 6
for (var i = 0; i < BASE_64_CHARS.length; i++) {                                        // 7
  BASE_64_VALS[BASE_64_CHARS.charAt(i)] = i;                                            // 8
};                                                                                      // 9
                                                                                        // 10
base64Encode = function (array) {                                                       // 11
  var answer = [];                                                                      // 12
  var a = null;                                                                         // 13
  var b = null;                                                                         // 14
  var c = null;                                                                         // 15
  var d = null;                                                                         // 16
  for (var i = 0; i < array.length; i++) {                                              // 17
    switch (i % 3) {                                                                    // 18
    case 0:                                                                             // 19
      a = (array[i] >> 2) & 0x3F;                                                       // 20
      b = (array[i] & 0x03) << 4;                                                       // 21
      break;                                                                            // 22
    case 1:                                                                             // 23
      b = b | (array[i] >> 4) & 0xF;                                                    // 24
      c = (array[i] & 0xF) << 2;                                                        // 25
      break;                                                                            // 26
    case 2:                                                                             // 27
      c = c | (array[i] >> 6) & 0x03;                                                   // 28
      d = array[i] & 0x3F;                                                              // 29
      answer.push(getChar(a));                                                          // 30
      answer.push(getChar(b));                                                          // 31
      answer.push(getChar(c));                                                          // 32
      answer.push(getChar(d));                                                          // 33
      a = null;                                                                         // 34
      b = null;                                                                         // 35
      c = null;                                                                         // 36
      d = null;                                                                         // 37
      break;                                                                            // 38
    }                                                                                   // 39
  }                                                                                     // 40
  if (a != null) {                                                                      // 41
    answer.push(getChar(a));                                                            // 42
    answer.push(getChar(b));                                                            // 43
    if (c == null)                                                                      // 44
      answer.push('=');                                                                 // 45
    else                                                                                // 46
      answer.push(getChar(c));                                                          // 47
    if (d == null)                                                                      // 48
      answer.push('=');                                                                 // 49
  }                                                                                     // 50
  return answer.join("");                                                               // 51
};                                                                                      // 52
                                                                                        // 53
var getChar = function (val) {                                                          // 54
  return BASE_64_CHARS.charAt(val);                                                     // 55
};                                                                                      // 56
                                                                                        // 57
var getVal = function (ch) {                                                            // 58
  if (ch === '=') {                                                                     // 59
    return -1;                                                                          // 60
  }                                                                                     // 61
  return BASE_64_VALS[ch];                                                              // 62
};                                                                                      // 63
                                                                                        // 64
EJSON.newBinary = function (len) {                                                      // 65
  if (typeof Uint8Array === 'undefined' || typeof ArrayBuffer === 'undefined') {        // 66
    var ret = [];                                                                       // 67
    for (var i = 0; i < len; i++) {                                                     // 68
      ret.push(0);                                                                      // 69
    }                                                                                   // 70
    ret.$Uint8ArrayPolyfill = true;                                                     // 71
    return ret;                                                                         // 72
  }                                                                                     // 73
  return new Uint8Array(new ArrayBuffer(len));                                          // 74
};                                                                                      // 75
                                                                                        // 76
base64Decode = function (str) {                                                         // 77
  var len = Math.floor((str.length*3)/4);                                               // 78
  if (str.charAt(str.length - 1) == '=') {                                              // 79
    len--;                                                                              // 80
    if (str.charAt(str.length - 2) == '=')                                              // 81
      len--;                                                                            // 82
  }                                                                                     // 83
  var arr = EJSON.newBinary(len);                                                       // 84
                                                                                        // 85
  var one = null;                                                                       // 86
  var two = null;                                                                       // 87
  var three = null;                                                                     // 88
                                                                                        // 89
  var j = 0;                                                                            // 90
                                                                                        // 91
  for (var i = 0; i < str.length; i++) {                                                // 92
    var c = str.charAt(i);                                                              // 93
    var v = getVal(c);                                                                  // 94
    switch (i % 4) {                                                                    // 95
    case 0:                                                                             // 96
      if (v < 0)                                                                        // 97
        throw new Error('invalid base64 string');                                       // 98
      one = v << 2;                                                                     // 99
      break;                                                                            // 100
    case 1:                                                                             // 101
      if (v < 0)                                                                        // 102
        throw new Error('invalid base64 string');                                       // 103
      one = one | (v >> 4);                                                             // 104
      arr[j++] = one;                                                                   // 105
      two = (v & 0x0F) << 4;                                                            // 106
      break;                                                                            // 107
    case 2:                                                                             // 108
      if (v >= 0) {                                                                     // 109
        two = two | (v >> 2);                                                           // 110
        arr[j++] = two;                                                                 // 111
        three = (v & 0x03) << 6;                                                        // 112
      }                                                                                 // 113
      break;                                                                            // 114
    case 3:                                                                             // 115
      if (v >= 0) {                                                                     // 116
        arr[j++] = three | v;                                                           // 117
      }                                                                                 // 118
      break;                                                                            // 119
    }                                                                                   // 120
  }                                                                                     // 121
  return arr;                                                                           // 122
};                                                                                      // 123
                                                                                        // 124
EJSONTest.base64Encode = base64Encode;                                                  // 125
                                                                                        // 126
EJSONTest.base64Decode = base64Decode;                                                  // 127
                                                                                        // 128
//////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.ejson = {
  EJSON: EJSON,
  EJSONTest: EJSONTest
};

})();
