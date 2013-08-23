(function () {

/* Package-scope variables */
var _, exports;

(function () {

///////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                       //
// packages/underscore/pre.js                                                                            //
//                                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                         //
// Define an object named exports. This will cause underscore.js to put `_` as a                         // 1
// field on it, instead of in the global namespace.  See also post.js.                                   // 2
exports = {};                                                                                            // 3
                                                                                                         // 4
///////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

///////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                       //
// packages/underscore/underscore.js                                                                     //
//                                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                         //
//     Underscore.js 1.5.1                                                                               // 1
//     http://underscorejs.org                                                                           // 2
//     (c) 2009-2013 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors                // 3
//     Underscore may be freely distributed under the MIT license.                                       // 4
                                                                                                         // 5
(function() {                                                                                            // 6
                                                                                                         // 7
  // Baseline setup                                                                                      // 8
  // --------------                                                                                      // 9
                                                                                                         // 10
  // Establish the root object, `window` in the browser, or `global` on the server.                      // 11
  var root = this;                                                                                       // 12
                                                                                                         // 13
  // Save the previous value of the `_` variable.                                                        // 14
  var previousUnderscore = root._;                                                                       // 15
                                                                                                         // 16
  // Establish the object that gets returned to break out of a loop iteration.                           // 17
  var breaker = {};                                                                                      // 18
                                                                                                         // 19
  // Save bytes in the minified (but not gzipped) version:                                               // 20
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;         // 21
                                                                                                         // 22
  // Create quick reference variables for speed access to core prototypes.                               // 23
  var                                                                                                    // 24
    push             = ArrayProto.push,                                                                  // 25
    slice            = ArrayProto.slice,                                                                 // 26
    concat           = ArrayProto.concat,                                                                // 27
    toString         = ObjProto.toString,                                                                // 28
    hasOwnProperty   = ObjProto.hasOwnProperty;                                                          // 29
                                                                                                         // 30
  // All **ECMAScript 5** native function implementations that we hope to use                            // 31
  // are declared here.                                                                                  // 32
  var                                                                                                    // 33
    nativeForEach      = ArrayProto.forEach,                                                             // 34
    nativeMap          = ArrayProto.map,                                                                 // 35
    nativeReduce       = ArrayProto.reduce,                                                              // 36
    nativeReduceRight  = ArrayProto.reduceRight,                                                         // 37
    nativeFilter       = ArrayProto.filter,                                                              // 38
    nativeEvery        = ArrayProto.every,                                                               // 39
    nativeSome         = ArrayProto.some,                                                                // 40
    nativeIndexOf      = ArrayProto.indexOf,                                                             // 41
    nativeLastIndexOf  = ArrayProto.lastIndexOf,                                                         // 42
    nativeIsArray      = Array.isArray,                                                                  // 43
    nativeKeys         = Object.keys,                                                                    // 44
    nativeBind         = FuncProto.bind;                                                                 // 45
                                                                                                         // 46
  // Create a safe reference to the Underscore object for use below.                                     // 47
  var _ = function(obj) {                                                                                // 48
    if (obj instanceof _) return obj;                                                                    // 49
    if (!(this instanceof _)) return new _(obj);                                                         // 50
    this._wrapped = obj;                                                                                 // 51
  };                                                                                                     // 52
                                                                                                         // 53
  // Export the Underscore object for **Node.js**, with                                                  // 54
  // backwards-compatibility for the old `require()` API. If we're in                                    // 55
  // the browser, add `_` as a global object via a string identifier,                                    // 56
  // for Closure Compiler "advanced" mode.                                                               // 57
  if (typeof exports !== 'undefined') {                                                                  // 58
    if (typeof module !== 'undefined' && module.exports) {                                               // 59
      exports = module.exports = _;                                                                      // 60
    }                                                                                                    // 61
    exports._ = _;                                                                                       // 62
  } else {                                                                                               // 63
    root._ = _;                                                                                          // 64
  }                                                                                                      // 65
                                                                                                         // 66
  // Current version.                                                                                    // 67
  _.VERSION = '1.5.1';                                                                                   // 68
                                                                                                         // 69
  // Collection Functions                                                                                // 70
  // --------------------                                                                                // 71
                                                                                                         // 72
  // The cornerstone, an `each` implementation, aka `forEach`.                                           // 73
  // Handles objects with the built-in `forEach`, arrays, and raw objects.                               // 74
  // Delegates to **ECMAScript 5**'s native `forEach` if available.                                      // 75
  var each = _.each = _.forEach = function(obj, iterator, context) {                                     // 76
    if (obj == null) return;                                                                             // 77
    if (nativeForEach && obj.forEach === nativeForEach) {                                                // 78
      obj.forEach(iterator, context);                                                                    // 79
    } else if (obj.length === +obj.length) {                                                             // 80
      for (var i = 0, l = obj.length; i < l; i++) {                                                      // 81
        if (iterator.call(context, obj[i], i, obj) === breaker) return;                                  // 82
      }                                                                                                  // 83
    } else {                                                                                             // 84
      for (var key in obj) {                                                                             // 85
        if (_.has(obj, key)) {                                                                           // 86
          if (iterator.call(context, obj[key], key, obj) === breaker) return;                            // 87
        }                                                                                                // 88
      }                                                                                                  // 89
    }                                                                                                    // 90
  };                                                                                                     // 91
                                                                                                         // 92
  // Return the results of applying the iterator to each element.                                        // 93
  // Delegates to **ECMAScript 5**'s native `map` if available.                                          // 94
  _.map = _.collect = function(obj, iterator, context) {                                                 // 95
    var results = [];                                                                                    // 96
    if (obj == null) return results;                                                                     // 97
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);                           // 98
    each(obj, function(value, index, list) {                                                             // 99
      results.push(iterator.call(context, value, index, list));                                          // 100
    });                                                                                                  // 101
    return results;                                                                                      // 102
  };                                                                                                     // 103
                                                                                                         // 104
  var reduceError = 'Reduce of empty array with no initial value';                                       // 105
                                                                                                         // 106
  // **Reduce** builds up a single result from a list of values, aka `inject`,                           // 107
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.                           // 108
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {                               // 109
    var initial = arguments.length > 2;                                                                  // 110
    if (obj == null) obj = [];                                                                           // 111
    if (nativeReduce && obj.reduce === nativeReduce) {                                                   // 112
      if (context) iterator = _.bind(iterator, context);                                                 // 113
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);                                // 114
    }                                                                                                    // 115
    each(obj, function(value, index, list) {                                                             // 116
      if (!initial) {                                                                                    // 117
        memo = value;                                                                                    // 118
        initial = true;                                                                                  // 119
      } else {                                                                                           // 120
        memo = iterator.call(context, memo, value, index, list);                                         // 121
      }                                                                                                  // 122
    });                                                                                                  // 123
    if (!initial) throw new TypeError(reduceError);                                                      // 124
    return memo;                                                                                         // 125
  };                                                                                                     // 126
                                                                                                         // 127
  // The right-associative version of reduce, also known as `foldr`.                                     // 128
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.                                  // 129
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {                                     // 130
    var initial = arguments.length > 2;                                                                  // 131
    if (obj == null) obj = [];                                                                           // 132
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {                                    // 133
      if (context) iterator = _.bind(iterator, context);                                                 // 134
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);                      // 135
    }                                                                                                    // 136
    var length = obj.length;                                                                             // 137
    if (length !== +length) {                                                                            // 138
      var keys = _.keys(obj);                                                                            // 139
      length = keys.length;                                                                              // 140
    }                                                                                                    // 141
    each(obj, function(value, index, list) {                                                             // 142
      index = keys ? keys[--length] : --length;                                                          // 143
      if (!initial) {                                                                                    // 144
        memo = obj[index];                                                                               // 145
        initial = true;                                                                                  // 146
      } else {                                                                                           // 147
        memo = iterator.call(context, memo, obj[index], index, list);                                    // 148
      }                                                                                                  // 149
    });                                                                                                  // 150
    if (!initial) throw new TypeError(reduceError);                                                      // 151
    return memo;                                                                                         // 152
  };                                                                                                     // 153
                                                                                                         // 154
  // Return the first value which passes a truth test. Aliased as `detect`.                              // 155
  _.find = _.detect = function(obj, iterator, context) {                                                 // 156
    var result;                                                                                          // 157
    any(obj, function(value, index, list) {                                                              // 158
      if (iterator.call(context, value, index, list)) {                                                  // 159
        result = value;                                                                                  // 160
        return true;                                                                                     // 161
      }                                                                                                  // 162
    });                                                                                                  // 163
    return result;                                                                                       // 164
  };                                                                                                     // 165
                                                                                                         // 166
  // Return all the elements that pass a truth test.                                                     // 167
  // Delegates to **ECMAScript 5**'s native `filter` if available.                                       // 168
  // Aliased as `select`.                                                                                // 169
  _.filter = _.select = function(obj, iterator, context) {                                               // 170
    var results = [];                                                                                    // 171
    if (obj == null) return results;                                                                     // 172
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(iterator, context);               // 173
    each(obj, function(value, index, list) {                                                             // 174
      if (iterator.call(context, value, index, list)) results.push(value);                               // 175
    });                                                                                                  // 176
    return results;                                                                                      // 177
  };                                                                                                     // 178
                                                                                                         // 179
  // Return all the elements for which a truth test fails.                                               // 180
  _.reject = function(obj, iterator, context) {                                                          // 181
    return _.filter(obj, function(value, index, list) {                                                  // 182
      return !iterator.call(context, value, index, list);                                                // 183
    }, context);                                                                                         // 184
  };                                                                                                     // 185
                                                                                                         // 186
  // Determine whether all of the elements match a truth test.                                           // 187
  // Delegates to **ECMAScript 5**'s native `every` if available.                                        // 188
  // Aliased as `all`.                                                                                   // 189
  _.every = _.all = function(obj, iterator, context) {                                                   // 190
    iterator || (iterator = _.identity);                                                                 // 191
    var result = true;                                                                                   // 192
    if (obj == null) return result;                                                                      // 193
    if (nativeEvery && obj.every === nativeEvery) return obj.every(iterator, context);                   // 194
    each(obj, function(value, index, list) {                                                             // 195
      if (!(result = result && iterator.call(context, value, index, list))) return breaker;              // 196
    });                                                                                                  // 197
    return !!result;                                                                                     // 198
  };                                                                                                     // 199
                                                                                                         // 200
  // Determine if at least one element in the object matches a truth test.                               // 201
  // Delegates to **ECMAScript 5**'s native `some` if available.                                         // 202
  // Aliased as `any`.                                                                                   // 203
  var any = _.some = _.any = function(obj, iterator, context) {                                          // 204
    iterator || (iterator = _.identity);                                                                 // 205
    var result = false;                                                                                  // 206
    if (obj == null) return result;                                                                      // 207
    if (nativeSome && obj.some === nativeSome) return obj.some(iterator, context);                       // 208
    each(obj, function(value, index, list) {                                                             // 209
      if (result || (result = iterator.call(context, value, index, list))) return breaker;               // 210
    });                                                                                                  // 211
    return !!result;                                                                                     // 212
  };                                                                                                     // 213
                                                                                                         // 214
  // Determine if the array or object contains a given value (using `===`).                              // 215
  // Aliased as `include`.                                                                               // 216
  _.contains = _.include = function(obj, target) {                                                       // 217
    if (obj == null) return false;                                                                       // 218
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;                // 219
    return any(obj, function(value) {                                                                    // 220
      return value === target;                                                                           // 221
    });                                                                                                  // 222
  };                                                                                                     // 223
                                                                                                         // 224
  // Invoke a method (with arguments) on every item in a collection.                                     // 225
  _.invoke = function(obj, method) {                                                                     // 226
    var args = slice.call(arguments, 2);                                                                 // 227
    var isFunc = _.isFunction(method);                                                                   // 228
    return _.map(obj, function(value) {                                                                  // 229
      return (isFunc ? method : value[method]).apply(value, args);                                       // 230
    });                                                                                                  // 231
  };                                                                                                     // 232
                                                                                                         // 233
  // Convenience version of a common use case of `map`: fetching a property.                             // 234
  _.pluck = function(obj, key) {                                                                         // 235
    return _.map(obj, function(value){ return value[key]; });                                            // 236
  };                                                                                                     // 237
                                                                                                         // 238
  // Convenience version of a common use case of `filter`: selecting only objects                        // 239
  // containing specific `key:value` pairs.                                                              // 240
  _.where = function(obj, attrs, first) {                                                                // 241
    if (_.isEmpty(attrs)) return first ? void 0 : [];                                                    // 242
    return _[first ? 'find' : 'filter'](obj, function(value) {                                           // 243
      for (var key in attrs) {                                                                           // 244
        if (attrs[key] !== value[key]) return false;                                                     // 245
      }                                                                                                  // 246
      return true;                                                                                       // 247
    });                                                                                                  // 248
  };                                                                                                     // 249
                                                                                                         // 250
  // Convenience version of a common use case of `find`: getting the first object                        // 251
  // containing specific `key:value` pairs.                                                              // 252
  _.findWhere = function(obj, attrs) {                                                                   // 253
    return _.where(obj, attrs, true);                                                                    // 254
  };                                                                                                     // 255
                                                                                                         // 256
  // Return the maximum element or (element-based computation).                                          // 257
  // Can't optimize arrays of integers longer than 65,535 elements.                                      // 258
  // See [WebKit Bug 80797](https://bugs.webkit.org/show_bug.cgi?id=80797)                               // 259
  _.max = function(obj, iterator, context) {                                                             // 260
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {                       // 261
      return Math.max.apply(Math, obj);                                                                  // 262
    }                                                                                                    // 263
    if (!iterator && _.isEmpty(obj)) return -Infinity;                                                   // 264
    var result = {computed : -Infinity, value: -Infinity};                                               // 265
    each(obj, function(value, index, list) {                                                             // 266
      var computed = iterator ? iterator.call(context, value, index, list) : value;                      // 267
      computed > result.computed && (result = {value : value, computed : computed});                     // 268
    });                                                                                                  // 269
    return result.value;                                                                                 // 270
  };                                                                                                     // 271
                                                                                                         // 272
  // Return the minimum element (or element-based computation).                                          // 273
  _.min = function(obj, iterator, context) {                                                             // 274
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {                       // 275
      return Math.min.apply(Math, obj);                                                                  // 276
    }                                                                                                    // 277
    if (!iterator && _.isEmpty(obj)) return Infinity;                                                    // 278
    var result = {computed : Infinity, value: Infinity};                                                 // 279
    each(obj, function(value, index, list) {                                                             // 280
      var computed = iterator ? iterator.call(context, value, index, list) : value;                      // 281
      computed < result.computed && (result = {value : value, computed : computed});                     // 282
    });                                                                                                  // 283
    return result.value;                                                                                 // 284
  };                                                                                                     // 285
                                                                                                         // 286
  // Shuffle an array.                                                                                   // 287
  _.shuffle = function(obj) {                                                                            // 288
    var rand;                                                                                            // 289
    var index = 0;                                                                                       // 290
    var shuffled = [];                                                                                   // 291
    each(obj, function(value) {                                                                          // 292
      rand = _.random(index++);                                                                          // 293
      shuffled[index - 1] = shuffled[rand];                                                              // 294
      shuffled[rand] = value;                                                                            // 295
    });                                                                                                  // 296
    return shuffled;                                                                                     // 297
  };                                                                                                     // 298
                                                                                                         // 299
  // An internal function to generate lookup iterators.                                                  // 300
  var lookupIterator = function(value) {                                                                 // 301
    return _.isFunction(value) ? value : function(obj){ return obj[value]; };                            // 302
  };                                                                                                     // 303
                                                                                                         // 304
  // Sort the object's values by a criterion produced by an iterator.                                    // 305
  _.sortBy = function(obj, value, context) {                                                             // 306
    var iterator = lookupIterator(value);                                                                // 307
    return _.pluck(_.map(obj, function(value, index, list) {                                             // 308
      return {                                                                                           // 309
        value : value,                                                                                   // 310
        index : index,                                                                                   // 311
        criteria : iterator.call(context, value, index, list)                                            // 312
      };                                                                                                 // 313
    }).sort(function(left, right) {                                                                      // 314
      var a = left.criteria;                                                                             // 315
      var b = right.criteria;                                                                            // 316
      if (a !== b) {                                                                                     // 317
        if (a > b || a === void 0) return 1;                                                             // 318
        if (a < b || b === void 0) return -1;                                                            // 319
      }                                                                                                  // 320
      return left.index < right.index ? -1 : 1;                                                          // 321
    }), 'value');                                                                                        // 322
  };                                                                                                     // 323
                                                                                                         // 324
  // An internal function used for aggregate "group by" operations.                                      // 325
  var group = function(obj, value, context, behavior) {                                                  // 326
    var result = {};                                                                                     // 327
    var iterator = lookupIterator(value == null ? _.identity : value);                                   // 328
    each(obj, function(value, index) {                                                                   // 329
      var key = iterator.call(context, value, index, obj);                                               // 330
      behavior(result, key, value);                                                                      // 331
    });                                                                                                  // 332
    return result;                                                                                       // 333
  };                                                                                                     // 334
                                                                                                         // 335
  // Groups the object's values by a criterion. Pass either a string attribute                           // 336
  // to group by, or a function that returns the criterion.                                              // 337
  _.groupBy = function(obj, value, context) {                                                            // 338
    return group(obj, value, context, function(result, key, value) {                                     // 339
      (_.has(result, key) ? result[key] : (result[key] = [])).push(value);                               // 340
    });                                                                                                  // 341
  };                                                                                                     // 342
                                                                                                         // 343
  // Counts instances of an object that group by a certain criterion. Pass                               // 344
  // either a string attribute to count by, or a function that returns the                               // 345
  // criterion.                                                                                          // 346
  _.countBy = function(obj, value, context) {                                                            // 347
    return group(obj, value, context, function(result, key) {                                            // 348
      if (!_.has(result, key)) result[key] = 0;                                                          // 349
      result[key]++;                                                                                     // 350
    });                                                                                                  // 351
  };                                                                                                     // 352
                                                                                                         // 353
  // Use a comparator function to figure out the smallest index at which                                 // 354
  // an object should be inserted so as to maintain order. Uses binary search.                           // 355
  _.sortedIndex = function(array, obj, iterator, context) {                                              // 356
    iterator = iterator == null ? _.identity : lookupIterator(iterator);                                 // 357
    var value = iterator.call(context, obj);                                                             // 358
    var low = 0, high = array.length;                                                                    // 359
    while (low < high) {                                                                                 // 360
      var mid = (low + high) >>> 1;                                                                      // 361
      iterator.call(context, array[mid]) < value ? low = mid + 1 : high = mid;                           // 362
    }                                                                                                    // 363
    return low;                                                                                          // 364
  };                                                                                                     // 365
                                                                                                         // 366
  // Safely create a real, live array from anything iterable.                                            // 367
  _.toArray = function(obj) {                                                                            // 368
    if (!obj) return [];                                                                                 // 369
    if (_.isArray(obj)) return slice.call(obj);                                                          // 370
    if (obj.length === +obj.length) return _.map(obj, _.identity);                                       // 371
    return _.values(obj);                                                                                // 372
  };                                                                                                     // 373
                                                                                                         // 374
  // Return the number of elements in an object.                                                         // 375
  _.size = function(obj) {                                                                               // 376
    if (obj == null) return 0;                                                                           // 377
    return (obj.length === +obj.length) ? obj.length : _.keys(obj).length;                               // 378
  };                                                                                                     // 379
                                                                                                         // 380
  // Array Functions                                                                                     // 381
  // ---------------                                                                                     // 382
                                                                                                         // 383
  // Get the first element of an array. Passing **n** will return the first N                            // 384
  // values in the array. Aliased as `head` and `take`. The **guard** check                              // 385
  // allows it to work with `_.map`.                                                                     // 386
  _.first = _.head = _.take = function(array, n, guard) {                                                // 387
    if (array == null) return void 0;                                                                    // 388
    return (n != null) && !guard ? slice.call(array, 0, n) : array[0];                                   // 389
  };                                                                                                     // 390
                                                                                                         // 391
  // Returns everything but the last entry of the array. Especially useful on                            // 392
  // the arguments object. Passing **n** will return all the values in                                   // 393
  // the array, excluding the last N. The **guard** check allows it to work with                         // 394
  // `_.map`.                                                                                            // 395
  _.initial = function(array, n, guard) {                                                                // 396
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));                          // 397
  };                                                                                                     // 398
                                                                                                         // 399
  // Get the last element of an array. Passing **n** will return the last N                              // 400
  // values in the array. The **guard** check allows it to work with `_.map`.                            // 401
  _.last = function(array, n, guard) {                                                                   // 402
    if (array == null) return void 0;                                                                    // 403
    if ((n != null) && !guard) {                                                                         // 404
      return slice.call(array, Math.max(array.length - n, 0));                                           // 405
    } else {                                                                                             // 406
      return array[array.length - 1];                                                                    // 407
    }                                                                                                    // 408
  };                                                                                                     // 409
                                                                                                         // 410
  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.                  // 411
  // Especially useful on the arguments object. Passing an **n** will return                             // 412
  // the rest N values in the array. The **guard**                                                       // 413
  // check allows it to work with `_.map`.                                                               // 414
  _.rest = _.tail = _.drop = function(array, n, guard) {                                                 // 415
    return slice.call(array, (n == null) || guard ? 1 : n);                                              // 416
  };                                                                                                     // 417
                                                                                                         // 418
  // Trim out all falsy values from an array.                                                            // 419
  _.compact = function(array) {                                                                          // 420
    return _.filter(array, _.identity);                                                                  // 421
  };                                                                                                     // 422
                                                                                                         // 423
  // Internal implementation of a recursive `flatten` function.                                          // 424
  var flatten = function(input, shallow, output) {                                                       // 425
    if (shallow && _.every(input, _.isArray)) {                                                          // 426
      return concat.apply(output, input);                                                                // 427
    }                                                                                                    // 428
    each(input, function(value) {                                                                        // 429
      if (_.isArray(value) || _.isArguments(value)) {                                                    // 430
        shallow ? push.apply(output, value) : flatten(value, shallow, output);                           // 431
      } else {                                                                                           // 432
        output.push(value);                                                                              // 433
      }                                                                                                  // 434
    });                                                                                                  // 435
    return output;                                                                                       // 436
  };                                                                                                     // 437
                                                                                                         // 438
  // Return a completely flattened version of an array.                                                  // 439
  _.flatten = function(array, shallow) {                                                                 // 440
    return flatten(array, shallow, []);                                                                  // 441
  };                                                                                                     // 442
                                                                                                         // 443
  // Return a version of the array that does not contain the specified value(s).                         // 444
  _.without = function(array) {                                                                          // 445
    return _.difference(array, slice.call(arguments, 1));                                                // 446
  };                                                                                                     // 447
                                                                                                         // 448
  // Produce a duplicate-free version of the array. If the array has already                             // 449
  // been sorted, you have the option of using a faster algorithm.                                       // 450
  // Aliased as `unique`.                                                                                // 451
  _.uniq = _.unique = function(array, isSorted, iterator, context) {                                     // 452
    if (_.isFunction(isSorted)) {                                                                        // 453
      context = iterator;                                                                                // 454
      iterator = isSorted;                                                                               // 455
      isSorted = false;                                                                                  // 456
    }                                                                                                    // 457
    var initial = iterator ? _.map(array, iterator, context) : array;                                    // 458
    var results = [];                                                                                    // 459
    var seen = [];                                                                                       // 460
    each(initial, function(value, index) {                                                               // 461
      if (isSorted ? (!index || seen[seen.length - 1] !== value) : !_.contains(seen, value)) {           // 462
        seen.push(value);                                                                                // 463
        results.push(array[index]);                                                                      // 464
      }                                                                                                  // 465
    });                                                                                                  // 466
    return results;                                                                                      // 467
  };                                                                                                     // 468
                                                                                                         // 469
  // Produce an array that contains the union: each distinct element from all of                         // 470
  // the passed-in arrays.                                                                               // 471
  _.union = function() {                                                                                 // 472
    return _.uniq(_.flatten(arguments, true));                                                           // 473
  };                                                                                                     // 474
                                                                                                         // 475
  // Produce an array that contains every item shared between all the                                    // 476
  // passed-in arrays.                                                                                   // 477
  _.intersection = function(array) {                                                                     // 478
    var rest = slice.call(arguments, 1);                                                                 // 479
    return _.filter(_.uniq(array), function(item) {                                                      // 480
      return _.every(rest, function(other) {                                                             // 481
        return _.indexOf(other, item) >= 0;                                                              // 482
      });                                                                                                // 483
    });                                                                                                  // 484
  };                                                                                                     // 485
                                                                                                         // 486
  // Take the difference between one array and a number of other arrays.                                 // 487
  // Only the elements present in just the first array will remain.                                      // 488
  _.difference = function(array) {                                                                       // 489
    var rest = concat.apply(ArrayProto, slice.call(arguments, 1));                                       // 490
    return _.filter(array, function(value){ return !_.contains(rest, value); });                         // 491
  };                                                                                                     // 492
                                                                                                         // 493
  // Zip together multiple lists into a single array -- elements that share                              // 494
  // an index go together.                                                                               // 495
  _.zip = function() {                                                                                   // 496
    var length = _.max(_.pluck(arguments, "length").concat(0));                                          // 497
    var results = new Array(length);                                                                     // 498
    for (var i = 0; i < length; i++) {                                                                   // 499
      results[i] = _.pluck(arguments, '' + i);                                                           // 500
    }                                                                                                    // 501
    return results;                                                                                      // 502
  };                                                                                                     // 503
                                                                                                         // 504
  // Converts lists into objects. Pass either a single array of `[key, value]`                           // 505
  // pairs, or two parallel arrays of the same length -- one of keys, and one of                         // 506
  // the corresponding values.                                                                           // 507
  _.object = function(list, values) {                                                                    // 508
    if (list == null) return {};                                                                         // 509
    var result = {};                                                                                     // 510
    for (var i = 0, l = list.length; i < l; i++) {                                                       // 511
      if (values) {                                                                                      // 512
        result[list[i]] = values[i];                                                                     // 513
      } else {                                                                                           // 514
        result[list[i][0]] = list[i][1];                                                                 // 515
      }                                                                                                  // 516
    }                                                                                                    // 517
    return result;                                                                                       // 518
  };                                                                                                     // 519
                                                                                                         // 520
  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),                       // 521
  // we need this function. Return the position of the first occurrence of an                            // 522
  // item in an array, or -1 if the item is not included in the array.                                   // 523
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.                                      // 524
  // If the array is large and already in sort order, pass `true`                                        // 525
  // for **isSorted** to use binary search.                                                              // 526
  _.indexOf = function(array, item, isSorted) {                                                          // 527
    if (array == null) return -1;                                                                        // 528
    var i = 0, l = array.length;                                                                         // 529
    if (isSorted) {                                                                                      // 530
      if (typeof isSorted == 'number') {                                                                 // 531
        i = (isSorted < 0 ? Math.max(0, l + isSorted) : isSorted);                                       // 532
      } else {                                                                                           // 533
        i = _.sortedIndex(array, item);                                                                  // 534
        return array[i] === item ? i : -1;                                                               // 535
      }                                                                                                  // 536
    }                                                                                                    // 537
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item, isSorted);          // 538
    for (; i < l; i++) if (array[i] === item) return i;                                                  // 539
    return -1;                                                                                           // 540
  };                                                                                                     // 541
                                                                                                         // 542
  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.                                  // 543
  _.lastIndexOf = function(array, item, from) {                                                          // 544
    if (array == null) return -1;                                                                        // 545
    var hasIndex = from != null;                                                                         // 546
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) {                                  // 547
      return hasIndex ? array.lastIndexOf(item, from) : array.lastIndexOf(item);                         // 548
    }                                                                                                    // 549
    var i = (hasIndex ? from : array.length);                                                            // 550
    while (i--) if (array[i] === item) return i;                                                         // 551
    return -1;                                                                                           // 552
  };                                                                                                     // 553
                                                                                                         // 554
  // Generate an integer Array containing an arithmetic progression. A port of                           // 555
  // the native Python `range()` function. See                                                           // 556
  // [the Python documentation](http://docs.python.org/library/functions.html#range).                    // 557
  _.range = function(start, stop, step) {                                                                // 558
    if (arguments.length <= 1) {                                                                         // 559
      stop = start || 0;                                                                                 // 560
      start = 0;                                                                                         // 561
    }                                                                                                    // 562
    step = arguments[2] || 1;                                                                            // 563
                                                                                                         // 564
    var len = Math.max(Math.ceil((stop - start) / step), 0);                                             // 565
    var idx = 0;                                                                                         // 566
    var range = new Array(len);                                                                          // 567
                                                                                                         // 568
    while(idx < len) {                                                                                   // 569
      range[idx++] = start;                                                                              // 570
      start += step;                                                                                     // 571
    }                                                                                                    // 572
                                                                                                         // 573
    return range;                                                                                        // 574
  };                                                                                                     // 575
                                                                                                         // 576
  // Function (ahem) Functions                                                                           // 577
  // ------------------                                                                                  // 578
                                                                                                         // 579
  // Reusable constructor function for prototype setting.                                                // 580
  var ctor = function(){};                                                                               // 581
                                                                                                         // 582
  // Create a function bound to a given object (assigning `this`, and arguments,                         // 583
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if                              // 584
  // available.                                                                                          // 585
  _.bind = function(func, context) {                                                                     // 586
    var args, bound;                                                                                     // 587
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1)); // 588
    if (!_.isFunction(func)) throw new TypeError;                                                        // 589
    args = slice.call(arguments, 2);                                                                     // 590
    return bound = function() {                                                                          // 591
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));      // 592
      ctor.prototype = func.prototype;                                                                   // 593
      var self = new ctor;                                                                               // 594
      ctor.prototype = null;                                                                             // 595
      var result = func.apply(self, args.concat(slice.call(arguments)));                                 // 596
      if (Object(result) === result) return result;                                                      // 597
      return self;                                                                                       // 598
    };                                                                                                   // 599
  };                                                                                                     // 600
                                                                                                         // 601
  // Partially apply a function by creating a version that has had some of its                           // 602
  // arguments pre-filled, without changing its dynamic `this` context.                                  // 603
  _.partial = function(func) {                                                                           // 604
    var args = slice.call(arguments, 1);                                                                 // 605
    return function() {                                                                                  // 606
      return func.apply(this, args.concat(slice.call(arguments)));                                       // 607
    };                                                                                                   // 608
  };                                                                                                     // 609
                                                                                                         // 610
  // Bind all of an object's methods to that object. Useful for ensuring that                            // 611
  // all callbacks defined on an object belong to it.                                                    // 612
  _.bindAll = function(obj) {                                                                            // 613
    var funcs = slice.call(arguments, 1);                                                                // 614
    if (funcs.length === 0) throw new Error("bindAll must be passed function names");                    // 615
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });                                          // 616
    return obj;                                                                                          // 617
  };                                                                                                     // 618
                                                                                                         // 619
  // Memoize an expensive function by storing its results.                                               // 620
  _.memoize = function(func, hasher) {                                                                   // 621
    var memo = {};                                                                                       // 622
    hasher || (hasher = _.identity);                                                                     // 623
    return function() {                                                                                  // 624
      var key = hasher.apply(this, arguments);                                                           // 625
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));                   // 626
    };                                                                                                   // 627
  };                                                                                                     // 628
                                                                                                         // 629
  // Delays a function for the given number of milliseconds, and then calls                              // 630
  // it with the arguments supplied.                                                                     // 631
  _.delay = function(func, wait) {                                                                       // 632
    var args = slice.call(arguments, 2);                                                                 // 633
    return setTimeout(function(){ return func.apply(null, args); }, wait);                               // 634
  };                                                                                                     // 635
                                                                                                         // 636
  // Defers a function, scheduling it to run after the current call stack has                            // 637
  // cleared.                                                                                            // 638
  _.defer = function(func) {                                                                             // 639
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));                                 // 640
  };                                                                                                     // 641
                                                                                                         // 642
  // Returns a function, that, when invoked, will only be triggered at most once                         // 643
  // during a given window of time. Normally, the throttled function will run                            // 644
  // as much as it can, without ever going more than once per `wait` duration;                           // 645
  // but if you'd like to disable the execution on the leading edge, pass                                // 646
  // `{leading: false}`. To disable execution on the trailing edge, ditto.                               // 647
  _.throttle = function(func, wait, options) {                                                           // 648
    var context, args, result;                                                                           // 649
    var timeout = null;                                                                                  // 650
    var previous = 0;                                                                                    // 651
    options || (options = {});                                                                           // 652
    var later = function() {                                                                             // 653
      previous = options.leading === false ? 0 : new Date;                                               // 654
      timeout = null;                                                                                    // 655
      result = func.apply(context, args);                                                                // 656
    };                                                                                                   // 657
    return function() {                                                                                  // 658
      var now = new Date;                                                                                // 659
      if (!previous && options.leading === false) previous = now;                                        // 660
      var remaining = wait - (now - previous);                                                           // 661
      context = this;                                                                                    // 662
      args = arguments;                                                                                  // 663
      if (remaining <= 0) {                                                                              // 664
        clearTimeout(timeout);                                                                           // 665
        timeout = null;                                                                                  // 666
        previous = now;                                                                                  // 667
        result = func.apply(context, args);                                                              // 668
      } else if (!timeout && options.trailing !== false) {                                               // 669
        timeout = setTimeout(later, remaining);                                                          // 670
      }                                                                                                  // 671
      return result;                                                                                     // 672
    };                                                                                                   // 673
  };                                                                                                     // 674
                                                                                                         // 675
  // Returns a function, that, as long as it continues to be invoked, will not                           // 676
  // be triggered. The function will be called after it stops being called for                           // 677
  // N milliseconds. If `immediate` is passed, trigger the function on the                               // 678
  // leading edge, instead of the trailing.                                                              // 679
  _.debounce = function(func, wait, immediate) {                                                         // 680
    var result;                                                                                          // 681
    var timeout = null;                                                                                  // 682
    return function() {                                                                                  // 683
      var context = this, args = arguments;                                                              // 684
      var later = function() {                                                                           // 685
        timeout = null;                                                                                  // 686
        if (!immediate) result = func.apply(context, args);                                              // 687
      };                                                                                                 // 688
      var callNow = immediate && !timeout;                                                               // 689
      clearTimeout(timeout);                                                                             // 690
      timeout = setTimeout(later, wait);                                                                 // 691
      if (callNow) result = func.apply(context, args);                                                   // 692
      return result;                                                                                     // 693
    };                                                                                                   // 694
  };                                                                                                     // 695
                                                                                                         // 696
  // Returns a function that will be executed at most one time, no matter how                            // 697
  // often you call it. Useful for lazy initialization.                                                  // 698
  _.once = function(func) {                                                                              // 699
    var ran = false, memo;                                                                               // 700
    return function() {                                                                                  // 701
      if (ran) return memo;                                                                              // 702
      ran = true;                                                                                        // 703
      memo = func.apply(this, arguments);                                                                // 704
      func = null;                                                                                       // 705
      return memo;                                                                                       // 706
    };                                                                                                   // 707
  };                                                                                                     // 708
                                                                                                         // 709
  // Returns the first function passed as an argument to the second,                                     // 710
  // allowing you to adjust arguments, run code before and after, and                                    // 711
  // conditionally execute the original function.                                                        // 712
  _.wrap = function(func, wrapper) {                                                                     // 713
    return function() {                                                                                  // 714
      var args = [func];                                                                                 // 715
      push.apply(args, arguments);                                                                       // 716
      return wrapper.apply(this, args);                                                                  // 717
    };                                                                                                   // 718
  };                                                                                                     // 719
                                                                                                         // 720
  // Returns a function that is the composition of a list of functions, each                             // 721
  // consuming the return value of the function that follows.                                            // 722
  _.compose = function() {                                                                               // 723
    var funcs = arguments;                                                                               // 724
    return function() {                                                                                  // 725
      var args = arguments;                                                                              // 726
      for (var i = funcs.length - 1; i >= 0; i--) {                                                      // 727
        args = [funcs[i].apply(this, args)];                                                             // 728
      }                                                                                                  // 729
      return args[0];                                                                                    // 730
    };                                                                                                   // 731
  };                                                                                                     // 732
                                                                                                         // 733
  // Returns a function that will only be executed after being called N times.                           // 734
  _.after = function(times, func) {                                                                      // 735
    return function() {                                                                                  // 736
      if (--times < 1) {                                                                                 // 737
        return func.apply(this, arguments);                                                              // 738
      }                                                                                                  // 739
    };                                                                                                   // 740
  };                                                                                                     // 741
                                                                                                         // 742
  // Object Functions                                                                                    // 743
  // ----------------                                                                                    // 744
                                                                                                         // 745
  // Retrieve the names of an object's properties.                                                       // 746
  // Delegates to **ECMAScript 5**'s native `Object.keys`                                                // 747
  _.keys = nativeKeys || function(obj) {                                                                 // 748
    if (obj !== Object(obj)) throw new TypeError('Invalid object');                                      // 749
    var keys = [];                                                                                       // 750
    for (var key in obj) if (_.has(obj, key)) keys.push(key);                                            // 751
    return keys;                                                                                         // 752
  };                                                                                                     // 753
                                                                                                         // 754
  // Retrieve the values of an object's properties.                                                      // 755
  _.values = function(obj) {                                                                             // 756
    var values = [];                                                                                     // 757
    for (var key in obj) if (_.has(obj, key)) values.push(obj[key]);                                     // 758
    return values;                                                                                       // 759
  };                                                                                                     // 760
                                                                                                         // 761
  // Convert an object into a list of `[key, value]` pairs.                                              // 762
  _.pairs = function(obj) {                                                                              // 763
    var pairs = [];                                                                                      // 764
    for (var key in obj) if (_.has(obj, key)) pairs.push([key, obj[key]]);                               // 765
    return pairs;                                                                                        // 766
  };                                                                                                     // 767
                                                                                                         // 768
  // Invert the keys and values of an object. The values must be serializable.                           // 769
  _.invert = function(obj) {                                                                             // 770
    var result = {};                                                                                     // 771
    for (var key in obj) if (_.has(obj, key)) result[obj[key]] = key;                                    // 772
    return result;                                                                                       // 773
  };                                                                                                     // 774
                                                                                                         // 775
  // Return a sorted list of the function names available on the object.                                 // 776
  // Aliased as `methods`                                                                                // 777
  _.functions = _.methods = function(obj) {                                                              // 778
    var names = [];                                                                                      // 779
    for (var key in obj) {                                                                               // 780
      if (_.isFunction(obj[key])) names.push(key);                                                       // 781
    }                                                                                                    // 782
    return names.sort();                                                                                 // 783
  };                                                                                                     // 784
                                                                                                         // 785
  // Extend a given object with all the properties in passed-in object(s).                               // 786
  _.extend = function(obj) {                                                                             // 787
    each(slice.call(arguments, 1), function(source) {                                                    // 788
      if (source) {                                                                                      // 789
        for (var prop in source) {                                                                       // 790
          obj[prop] = source[prop];                                                                      // 791
        }                                                                                                // 792
      }                                                                                                  // 793
    });                                                                                                  // 794
    return obj;                                                                                          // 795
  };                                                                                                     // 796
                                                                                                         // 797
  // Return a copy of the object only containing the whitelisted properties.                             // 798
  _.pick = function(obj) {                                                                               // 799
    var copy = {};                                                                                       // 800
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));                                       // 801
    each(keys, function(key) {                                                                           // 802
      if (key in obj) copy[key] = obj[key];                                                              // 803
    });                                                                                                  // 804
    return copy;                                                                                         // 805
  };                                                                                                     // 806
                                                                                                         // 807
   // Return a copy of the object without the blacklisted properties.                                    // 808
  _.omit = function(obj) {                                                                               // 809
    var copy = {};                                                                                       // 810
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));                                       // 811
    for (var key in obj) {                                                                               // 812
      if (!_.contains(keys, key)) copy[key] = obj[key];                                                  // 813
    }                                                                                                    // 814
    return copy;                                                                                         // 815
  };                                                                                                     // 816
                                                                                                         // 817
  // Fill in a given object with default properties.                                                     // 818
  _.defaults = function(obj) {                                                                           // 819
    each(slice.call(arguments, 1), function(source) {                                                    // 820
      if (source) {                                                                                      // 821
        for (var prop in source) {                                                                       // 822
          if (obj[prop] === void 0) obj[prop] = source[prop];                                            // 823
        }                                                                                                // 824
      }                                                                                                  // 825
    });                                                                                                  // 826
    return obj;                                                                                          // 827
  };                                                                                                     // 828
                                                                                                         // 829
  // Create a (shallow-cloned) duplicate of an object.                                                   // 830
  _.clone = function(obj) {                                                                              // 831
    if (!_.isObject(obj)) return obj;                                                                    // 832
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);                                             // 833
  };                                                                                                     // 834
                                                                                                         // 835
  // Invokes interceptor with the obj, and then returns obj.                                             // 836
  // The primary purpose of this method is to "tap into" a method chain, in                              // 837
  // order to perform operations on intermediate results within the chain.                               // 838
  _.tap = function(obj, interceptor) {                                                                   // 839
    interceptor(obj);                                                                                    // 840
    return obj;                                                                                          // 841
  };                                                                                                     // 842
                                                                                                         // 843
  // Internal recursive comparison function for `isEqual`.                                               // 844
  var eq = function(a, b, aStack, bStack) {                                                              // 845
    // Identical objects are equal. `0 === -0`, but they aren't identical.                               // 846
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).           // 847
    if (a === b) return a !== 0 || 1 / a == 1 / b;                                                       // 848
    // A strict comparison is necessary because `null == undefined`.                                     // 849
    if (a == null || b == null) return a === b;                                                          // 850
    // Unwrap any wrapped objects.                                                                       // 851
    if (a instanceof _) a = a._wrapped;                                                                  // 852
    if (b instanceof _) b = b._wrapped;                                                                  // 853
    // Compare `[[Class]]` names.                                                                        // 854
    var className = toString.call(a);                                                                    // 855
    if (className != toString.call(b)) return false;                                                     // 856
    switch (className) {                                                                                 // 857
      // Strings, numbers, dates, and booleans are compared by value.                                    // 858
      case '[object String]':                                                                            // 859
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is             // 860
        // equivalent to `new String("5")`.                                                              // 861
        return a == String(b);                                                                           // 862
      case '[object Number]':                                                                            // 863
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for               // 864
        // other numeric values.                                                                         // 865
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);                                  // 866
      case '[object Date]':                                                                              // 867
      case '[object Boolean]':                                                                           // 868
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their            // 869
        // millisecond representations. Note that invalid dates with millisecond representations         // 870
        // of `NaN` are not equivalent.                                                                  // 871
        return +a == +b;                                                                                 // 872
      // RegExps are compared by their source patterns and flags.                                        // 873
      case '[object RegExp]':                                                                            // 874
        return a.source == b.source &&                                                                   // 875
               a.global == b.global &&                                                                   // 876
               a.multiline == b.multiline &&                                                             // 877
               a.ignoreCase == b.ignoreCase;                                                             // 878
    }                                                                                                    // 879
    if (typeof a != 'object' || typeof b != 'object') return false;                                      // 880
    // Assume equality for cyclic structures. The algorithm for detecting cyclic                         // 881
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.                       // 882
    var length = aStack.length;                                                                          // 883
    while (length--) {                                                                                   // 884
      // Linear search. Performance is inversely proportional to the number of                           // 885
      // unique nested structures.                                                                       // 886
      if (aStack[length] == a) return bStack[length] == b;                                               // 887
    }                                                                                                    // 888
    // Objects with different constructors are not equivalent, but `Object`s                             // 889
    // from different frames are.                                                                        // 890
    var aCtor = a.constructor, bCtor = b.constructor;                                                    // 891
    if (aCtor !== bCtor && !(_.isFunction(aCtor) && (aCtor instanceof aCtor) &&                          // 892
                             _.isFunction(bCtor) && (bCtor instanceof bCtor))) {                         // 893
      return false;                                                                                      // 894
    }                                                                                                    // 895
    // Add the first object to the stack of traversed objects.                                           // 896
    aStack.push(a);                                                                                      // 897
    bStack.push(b);                                                                                      // 898
    var size = 0, result = true;                                                                         // 899
    // Recursively compare objects and arrays.                                                           // 900
    if (className == '[object Array]') {                                                                 // 901
      // Compare array lengths to determine if a deep comparison is necessary.                           // 902
      size = a.length;                                                                                   // 903
      result = size == b.length;                                                                         // 904
      if (result) {                                                                                      // 905
        // Deep compare the contents, ignoring non-numeric properties.                                   // 906
        while (size--) {                                                                                 // 907
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;                                   // 908
        }                                                                                                // 909
      }                                                                                                  // 910
    } else {                                                                                             // 911
      // Deep compare objects.                                                                           // 912
      for (var key in a) {                                                                               // 913
        if (_.has(a, key)) {                                                                             // 914
          // Count the expected number of properties.                                                    // 915
          size++;                                                                                        // 916
          // Deep compare each member.                                                                   // 917
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;                    // 918
        }                                                                                                // 919
      }                                                                                                  // 920
      // Ensure that both objects contain the same number of properties.                                 // 921
      if (result) {                                                                                      // 922
        for (key in b) {                                                                                 // 923
          if (_.has(b, key) && !(size--)) break;                                                         // 924
        }                                                                                                // 925
        result = !size;                                                                                  // 926
      }                                                                                                  // 927
    }                                                                                                    // 928
    // Remove the first object from the stack of traversed objects.                                      // 929
    aStack.pop();                                                                                        // 930
    bStack.pop();                                                                                        // 931
    return result;                                                                                       // 932
  };                                                                                                     // 933
                                                                                                         // 934
  // Perform a deep comparison to check if two objects are equal.                                        // 935
  _.isEqual = function(a, b) {                                                                           // 936
    return eq(a, b, [], []);                                                                             // 937
  };                                                                                                     // 938
                                                                                                         // 939
  // Is a given array, string, or object empty?                                                          // 940
  // An "empty" object has no enumerable own-properties.                                                 // 941
  _.isEmpty = function(obj) {                                                                            // 942
    if (obj == null) return true;                                                                        // 943
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;                                      // 944
    for (var key in obj) if (_.has(obj, key)) return false;                                              // 945
    return true;                                                                                         // 946
  };                                                                                                     // 947
                                                                                                         // 948
  // Is a given value a DOM element?                                                                     // 949
  _.isElement = function(obj) {                                                                          // 950
    return !!(obj && obj.nodeType === 1);                                                                // 951
  };                                                                                                     // 952
                                                                                                         // 953
  // Is a given value an array?                                                                          // 954
  // Delegates to ECMA5's native Array.isArray                                                           // 955
  _.isArray = nativeIsArray || function(obj) {                                                           // 956
    return toString.call(obj) == '[object Array]';                                                       // 957
  };                                                                                                     // 958
                                                                                                         // 959
  // Is a given variable an object?                                                                      // 960
  _.isObject = function(obj) {                                                                           // 961
    return obj === Object(obj);                                                                          // 962
  };                                                                                                     // 963
                                                                                                         // 964
  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.             // 965
  each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {                 // 966
    _['is' + name] = function(obj) {                                                                     // 967
      return toString.call(obj) == '[object ' + name + ']';                                              // 968
    };                                                                                                   // 969
  });                                                                                                    // 970
                                                                                                         // 971
  // Define a fallback version of the method in browsers (ahem, IE), where                               // 972
  // there isn't any inspectable "Arguments" type.                                                       // 973
  if (!_.isArguments(arguments)) {                                                                       // 974
    _.isArguments = function(obj) {                                                                      // 975
      return !!(obj && _.has(obj, 'callee'));                                                            // 976
    };                                                                                                   // 977
  }                                                                                                      // 978
                                                                                                         // 979
  // Optimize `isFunction` if appropriate.                                                               // 980
  if (typeof (/./) !== 'function') {                                                                     // 981
    _.isFunction = function(obj) {                                                                       // 982
      return typeof obj === 'function';                                                                  // 983
    };                                                                                                   // 984
  }                                                                                                      // 985
                                                                                                         // 986
  // Is a given object a finite number?                                                                  // 987
  _.isFinite = function(obj) {                                                                           // 988
    return isFinite(obj) && !isNaN(parseFloat(obj));                                                     // 989
  };                                                                                                     // 990
                                                                                                         // 991
  // Is the given value `NaN`? (NaN is the only number which does not equal itself).                     // 992
  _.isNaN = function(obj) {                                                                              // 993
    return _.isNumber(obj) && obj != +obj;                                                               // 994
  };                                                                                                     // 995
                                                                                                         // 996
  // Is a given value a boolean?                                                                         // 997
  _.isBoolean = function(obj) {                                                                          // 998
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';                    // 999
  };                                                                                                     // 1000
                                                                                                         // 1001
  // Is a given value equal to null?                                                                     // 1002
  _.isNull = function(obj) {                                                                             // 1003
    return obj === null;                                                                                 // 1004
  };                                                                                                     // 1005
                                                                                                         // 1006
  // Is a given variable undefined?                                                                      // 1007
  _.isUndefined = function(obj) {                                                                        // 1008
    return obj === void 0;                                                                               // 1009
  };                                                                                                     // 1010
                                                                                                         // 1011
  // Shortcut function for checking if an object has a given property directly                           // 1012
  // on itself (in other words, not on a prototype).                                                     // 1013
  _.has = function(obj, key) {                                                                           // 1014
    return hasOwnProperty.call(obj, key);                                                                // 1015
  };                                                                                                     // 1016
                                                                                                         // 1017
  // Utility Functions                                                                                   // 1018
  // -----------------                                                                                   // 1019
                                                                                                         // 1020
  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its                           // 1021
  // previous owner. Returns a reference to the Underscore object.                                       // 1022
  _.noConflict = function() {                                                                            // 1023
    root._ = previousUnderscore;                                                                         // 1024
    return this;                                                                                         // 1025
  };                                                                                                     // 1026
                                                                                                         // 1027
  // Keep the identity function around for default iterators.                                            // 1028
  _.identity = function(value) {                                                                         // 1029
    return value;                                                                                        // 1030
  };                                                                                                     // 1031
                                                                                                         // 1032
  // Run a function **n** times.                                                                         // 1033
  _.times = function(n, iterator, context) {                                                             // 1034
    var accum = Array(Math.max(0, n));                                                                   // 1035
    for (var i = 0; i < n; i++) accum[i] = iterator.call(context, i);                                    // 1036
    return accum;                                                                                        // 1037
  };                                                                                                     // 1038
                                                                                                         // 1039
  // Return a random integer between min and max (inclusive).                                            // 1040
  _.random = function(min, max) {                                                                        // 1041
    if (max == null) {                                                                                   // 1042
      max = min;                                                                                         // 1043
      min = 0;                                                                                           // 1044
    }                                                                                                    // 1045
    return min + Math.floor(Math.random() * (max - min + 1));                                            // 1046
  };                                                                                                     // 1047
                                                                                                         // 1048
  // List of HTML entities for escaping.                                                                 // 1049
  var entityMap = {                                                                                      // 1050
    escape: {                                                                                            // 1051
      '&': '&amp;',                                                                                      // 1052
      '<': '&lt;',                                                                                       // 1053
      '>': '&gt;',                                                                                       // 1054
      '"': '&quot;',                                                                                     // 1055
      "'": '&#x27;',                                                                                     // 1056
      '/': '&#x2F;'                                                                                      // 1057
    }                                                                                                    // 1058
  };                                                                                                     // 1059
  entityMap.unescape = _.invert(entityMap.escape);                                                       // 1060
                                                                                                         // 1061
  // Regexes containing the keys and values listed immediately above.                                    // 1062
  var entityRegexes = {                                                                                  // 1063
    escape:   new RegExp('[' + _.keys(entityMap.escape).join('') + ']', 'g'),                            // 1064
    unescape: new RegExp('(' + _.keys(entityMap.unescape).join('|') + ')', 'g')                          // 1065
  };                                                                                                     // 1066
                                                                                                         // 1067
  // Functions for escaping and unescaping strings to/from HTML interpolation.                           // 1068
  _.each(['escape', 'unescape'], function(method) {                                                      // 1069
    _[method] = function(string) {                                                                       // 1070
      if (string == null) return '';                                                                     // 1071
      return ('' + string).replace(entityRegexes[method], function(match) {                              // 1072
        return entityMap[method][match];                                                                 // 1073
      });                                                                                                // 1074
    };                                                                                                   // 1075
  });                                                                                                    // 1076
                                                                                                         // 1077
  // If the value of the named `property` is a function then invoke it with the                          // 1078
  // `object` as context; otherwise, return it.                                                          // 1079
  _.result = function(object, property) {                                                                // 1080
    if (object == null) return void 0;                                                                   // 1081
    var value = object[property];                                                                        // 1082
    return _.isFunction(value) ? value.call(object) : value;                                             // 1083
  };                                                                                                     // 1084
                                                                                                         // 1085
  // Add your own custom functions to the Underscore object.                                             // 1086
  _.mixin = function(obj) {                                                                              // 1087
    each(_.functions(obj), function(name){                                                               // 1088
      var func = _[name] = obj[name];                                                                    // 1089
      _.prototype[name] = function() {                                                                   // 1090
        var args = [this._wrapped];                                                                      // 1091
        push.apply(args, arguments);                                                                     // 1092
        return result.call(this, func.apply(_, args));                                                   // 1093
      };                                                                                                 // 1094
    });                                                                                                  // 1095
  };                                                                                                     // 1096
                                                                                                         // 1097
  // Generate a unique integer id (unique within the entire client session).                             // 1098
  // Useful for temporary DOM ids.                                                                       // 1099
  var idCounter = 0;                                                                                     // 1100
  _.uniqueId = function(prefix) {                                                                        // 1101
    var id = ++idCounter + '';                                                                           // 1102
    return prefix ? prefix + id : id;                                                                    // 1103
  };                                                                                                     // 1104
                                                                                                         // 1105
  // By default, Underscore uses ERB-style template delimiters, change the                               // 1106
  // following template settings to use alternative delimiters.                                          // 1107
  _.templateSettings = {                                                                                 // 1108
    evaluate    : /<%([\s\S]+?)%>/g,                                                                     // 1109
    interpolate : /<%=([\s\S]+?)%>/g,                                                                    // 1110
    escape      : /<%-([\s\S]+?)%>/g                                                                     // 1111
  };                                                                                                     // 1112
                                                                                                         // 1113
  // When customizing `templateSettings`, if you don't want to define an                                 // 1114
  // interpolation, evaluation or escaping regex, we need one that is                                    // 1115
  // guaranteed not to match.                                                                            // 1116
  var noMatch = /(.)^/;                                                                                  // 1117
                                                                                                         // 1118
  // Certain characters need to be escaped so that they can be put into a                                // 1119
  // string literal.                                                                                     // 1120
  var escapes = {                                                                                        // 1121
    "'":      "'",                                                                                       // 1122
    '\\':     '\\',                                                                                      // 1123
    '\r':     'r',                                                                                       // 1124
    '\n':     'n',                                                                                       // 1125
    '\t':     't',                                                                                       // 1126
    '\u2028': 'u2028',                                                                                   // 1127
    '\u2029': 'u2029'                                                                                    // 1128
  };                                                                                                     // 1129
                                                                                                         // 1130
  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;                                                          // 1131
                                                                                                         // 1132
  // JavaScript micro-templating, similar to John Resig's implementation.                                // 1133
  // Underscore templating handles arbitrary delimiters, preserves whitespace,                           // 1134
  // and correctly escapes quotes within interpolated code.                                              // 1135
  _.template = function(text, data, settings) {                                                          // 1136
    var render;                                                                                          // 1137
    settings = _.defaults({}, settings, _.templateSettings);                                             // 1138
                                                                                                         // 1139
    // Combine delimiters into one regular expression via alternation.                                   // 1140
    var matcher = new RegExp([                                                                           // 1141
      (settings.escape || noMatch).source,                                                               // 1142
      (settings.interpolate || noMatch).source,                                                          // 1143
      (settings.evaluate || noMatch).source                                                              // 1144
    ].join('|') + '|$', 'g');                                                                            // 1145
                                                                                                         // 1146
    // Compile the template source, escaping string literals appropriately.                              // 1147
    var index = 0;                                                                                       // 1148
    var source = "__p+='";                                                                               // 1149
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {                       // 1150
      source += text.slice(index, offset)                                                                // 1151
        .replace(escaper, function(match) { return '\\' + escapes[match]; });                            // 1152
                                                                                                         // 1153
      if (escape) {                                                                                      // 1154
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";                             // 1155
      }                                                                                                  // 1156
      if (interpolate) {                                                                                 // 1157
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";                                  // 1158
      }                                                                                                  // 1159
      if (evaluate) {                                                                                    // 1160
        source += "';\n" + evaluate + "\n__p+='";                                                        // 1161
      }                                                                                                  // 1162
      index = offset + match.length;                                                                     // 1163
      return match;                                                                                      // 1164
    });                                                                                                  // 1165
    source += "';\n";                                                                                    // 1166
                                                                                                         // 1167
    // If a variable is not specified, place data values in local scope.                                 // 1168
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';                                // 1169
                                                                                                         // 1170
    source = "var __t,__p='',__j=Array.prototype.join," +                                                // 1171
      "print=function(){__p+=__j.call(arguments,'');};\n" +                                              // 1172
      source + "return __p;\n";                                                                          // 1173
                                                                                                         // 1174
    try {                                                                                                // 1175
      render = new Function(settings.variable || 'obj', '_', source);                                    // 1176
    } catch (e) {                                                                                        // 1177
      e.source = source;                                                                                 // 1178
      throw e;                                                                                           // 1179
    }                                                                                                    // 1180
                                                                                                         // 1181
    if (data) return render(data, _);                                                                    // 1182
    var template = function(data) {                                                                      // 1183
      return render.call(this, data, _);                                                                 // 1184
    };                                                                                                   // 1185
                                                                                                         // 1186
    // Provide the compiled function source as a convenience for precompilation.                         // 1187
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';                // 1188
                                                                                                         // 1189
    return template;                                                                                     // 1190
  };                                                                                                     // 1191
                                                                                                         // 1192
  // Add a "chain" function, which will delegate to the wrapper.                                         // 1193
  _.chain = function(obj) {                                                                              // 1194
    return _(obj).chain();                                                                               // 1195
  };                                                                                                     // 1196
                                                                                                         // 1197
  // OOP                                                                                                 // 1198
  // ---------------                                                                                     // 1199
  // If Underscore is called as a function, it returns a wrapped object that                             // 1200
  // can be used OO-style. This wrapper holds altered versions of all the                                // 1201
  // underscore functions. Wrapped objects may be chained.                                               // 1202
                                                                                                         // 1203
  // Helper function to continue chaining intermediate results.                                          // 1204
  var result = function(obj) {                                                                           // 1205
    return this._chain ? _(obj).chain() : obj;                                                           // 1206
  };                                                                                                     // 1207
                                                                                                         // 1208
  // Add all of the Underscore functions to the wrapper object.                                          // 1209
  _.mixin(_);                                                                                            // 1210
                                                                                                         // 1211
  // Add all mutator Array functions to the wrapper.                                                     // 1212
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {                // 1213
    var method = ArrayProto[name];                                                                       // 1214
    _.prototype[name] = function() {                                                                     // 1215
      var obj = this._wrapped;                                                                           // 1216
      method.apply(obj, arguments);                                                                      // 1217
      if ((name == 'shift' || name == 'splice') && obj.length === 0) delete obj[0];                      // 1218
      return result.call(this, obj);                                                                     // 1219
    };                                                                                                   // 1220
  });                                                                                                    // 1221
                                                                                                         // 1222
  // Add all accessor Array functions to the wrapper.                                                    // 1223
  each(['concat', 'join', 'slice'], function(name) {                                                     // 1224
    var method = ArrayProto[name];                                                                       // 1225
    _.prototype[name] = function() {                                                                     // 1226
      return result.call(this, method.apply(this._wrapped, arguments));                                  // 1227
    };                                                                                                   // 1228
  });                                                                                                    // 1229
                                                                                                         // 1230
  _.extend(_.prototype, {                                                                                // 1231
                                                                                                         // 1232
    // Start chaining a wrapped Underscore object.                                                       // 1233
    chain: function() {                                                                                  // 1234
      this._chain = true;                                                                                // 1235
      return this;                                                                                       // 1236
    },                                                                                                   // 1237
                                                                                                         // 1238
    // Extracts the result from a wrapped and chained object.                                            // 1239
    value: function() {                                                                                  // 1240
      return this._wrapped;                                                                              // 1241
    }                                                                                                    // 1242
                                                                                                         // 1243
  });                                                                                                    // 1244
                                                                                                         // 1245
}).call(this);                                                                                           // 1246
                                                                                                         // 1247
///////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

///////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                       //
// packages/underscore/post.js                                                                           //
//                                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                         //
// This exports object was created in pre.js.  Now copy the `_` object from it                           // 1
// into the package-scope variable `_`, which will get exported.                                         // 2
_ = exports._;                                                                                           // 3
                                                                                                         // 4
///////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.underscore = {
  _: _
};

})();
