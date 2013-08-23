(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;
var EJSON = Package.ejson.EJSON;
var OrderedDict = Package['ordered-dict'].OrderedDict;
var Deps = Package.deps.Deps;
var Random = Package.random.Random;

/* Package-scope variables */
var LocalCollection;

(function () {

////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                    //
// packages/minimongo/minimongo.js                                                                    //
//                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                      //
// XXX type checking on selectors (graceful error if malformed)                                       // 1
                                                                                                      // 2
// LocalCollection: a set of documents that supports queries and modifiers.                           // 3
                                                                                                      // 4
// Cursor: a specification for a particular subset of documents, w/                                   // 5
// a defined order, limit, and offset.  creating a Cursor with LocalCollection.find(),                // 6
                                                                                                      // 7
// LiveResultsSet: the return value of a live query.                                                  // 8
                                                                                                      // 9
LocalCollection = function (name) {                                                                   // 10
  this.name = name;                                                                                   // 11
  this.docs = {}; // _id -> document (also containing id)                                             // 12
                                                                                                      // 13
  this._observeQueue = new Meteor._SynchronousQueue();                                                // 14
                                                                                                      // 15
  this.next_qid = 1; // live query id generator                                                       // 16
                                                                                                      // 17
  // qid -> live query object. keys:                                                                  // 18
  //  ordered: bool. ordered queries have moved callbacks and callbacks                               // 19
  //           take indices.                                                                          // 20
  //  results: array (ordered) or object (unordered) of current results                               // 21
  //  results_snapshot: snapshot of results. null if not paused.                                      // 22
  //  cursor: Cursor object for the query.                                                            // 23
  //  selector_f, sort_f, (callbacks): functions                                                      // 24
  this.queries = {};                                                                                  // 25
                                                                                                      // 26
  // null if not saving originals; a map from id to original document value if                        // 27
  // saving originals. See comments before saveOriginals().                                           // 28
  this._savedOriginals = null;                                                                        // 29
                                                                                                      // 30
  // True when observers are paused and we should not send callbacks.                                 // 31
  this.paused = false;                                                                                // 32
};                                                                                                    // 33
                                                                                                      // 34
                                                                                                      // 35
LocalCollection._applyChanges = function (doc, changeFields) {                                        // 36
  _.each(changeFields, function (value, key) {                                                        // 37
    if (value === undefined)                                                                          // 38
      delete doc[key];                                                                                // 39
    else                                                                                              // 40
      doc[key] = value;                                                                               // 41
  });                                                                                                 // 42
};                                                                                                    // 43
                                                                                                      // 44
var MinimongoError = function (message) {                                                             // 45
  var e = new Error(message);                                                                         // 46
  e.name = "MinimongoError";                                                                          // 47
  return e;                                                                                           // 48
};                                                                                                    // 49
                                                                                                      // 50
                                                                                                      // 51
// options may include sort, skip, limit, reactive                                                    // 52
// sort may be any of these forms:                                                                    // 53
//     {a: 1, b: -1}                                                                                  // 54
//     [["a", "asc"], ["b", "desc"]]                                                                  // 55
//     ["a", ["b", "desc"]]                                                                           // 56
//   (in the first form you're beholden to key enumeration order in                                   // 57
//   your javascript VM)                                                                              // 58
//                                                                                                    // 59
// reactive: if given, and false, don't register with Deps (default                                   // 60
// is true)                                                                                           // 61
//                                                                                                    // 62
// XXX possibly should support retrieving a subset of fields? and                                     // 63
// have it be a hint (ignored on the client, when not copying the                                     // 64
// doc?)                                                                                              // 65
//                                                                                                    // 66
// XXX sort does not yet support subkeys ('a.b') .. fix that!                                         // 67
// XXX add one more sort form: "key"                                                                  // 68
// XXX tests                                                                                          // 69
LocalCollection.prototype.find = function (selector, options) {                                       // 70
  // default syntax for everything is to omit the selector argument.                                  // 71
  // but if selector is explicitly passed in as false or undefined, we                                // 72
  // want a selector that matches nothing.                                                            // 73
  if (arguments.length === 0)                                                                         // 74
    selector = {};                                                                                    // 75
                                                                                                      // 76
  return new LocalCollection.Cursor(this, selector, options);                                         // 77
};                                                                                                    // 78
                                                                                                      // 79
// don't call this ctor directly.  use LocalCollection.find().                                        // 80
LocalCollection.Cursor = function (collection, selector, options) {                                   // 81
  var self = this;                                                                                    // 82
  if (!options) options = {};                                                                         // 83
                                                                                                      // 84
  this.collection = collection;                                                                       // 85
                                                                                                      // 86
  if (LocalCollection._selectorIsId(selector)) {                                                      // 87
    // stash for fast path                                                                            // 88
    self.selector_id = LocalCollection._idStringify(selector);                                        // 89
    self.selector_f = LocalCollection._compileSelector(selector);                                     // 90
    self.sort_f = undefined;                                                                          // 91
  } else {                                                                                            // 92
    self.selector_id = undefined;                                                                     // 93
    self.selector_f = LocalCollection._compileSelector(selector);                                     // 94
    self.sort_f = options.sort ? LocalCollection._compileSort(options.sort) : null;                   // 95
  }                                                                                                   // 96
  self.skip = options.skip;                                                                           // 97
  self.limit = options.limit;                                                                         // 98
  if (options.transform && typeof Deps !== "undefined")                                               // 99
    self._transform = Deps._makeNonreactive(options.transform);                                       // 100
  else                                                                                                // 101
    self._transform = options.transform;                                                              // 102
                                                                                                      // 103
  // db_objects is a list of the objects that match the cursor. (It's always a                        // 104
  // list, never an object: LocalCollection.Cursor is always ordered.)                                // 105
  self.db_objects = null;                                                                             // 106
  self.cursor_pos = 0;                                                                                // 107
                                                                                                      // 108
  // by default, queries register w/ Deps when it is available.                                       // 109
  if (typeof Deps !== "undefined")                                                                    // 110
    self.reactive = (options.reactive === undefined) ? true : options.reactive;                       // 111
};                                                                                                    // 112
                                                                                                      // 113
LocalCollection.Cursor.prototype.rewind = function () {                                               // 114
  var self = this;                                                                                    // 115
  self.db_objects = null;                                                                             // 116
  self.cursor_pos = 0;                                                                                // 117
};                                                                                                    // 118
                                                                                                      // 119
LocalCollection.prototype.findOne = function (selector, options) {                                    // 120
  if (arguments.length === 0)                                                                         // 121
    selector = {};                                                                                    // 122
                                                                                                      // 123
  // NOTE: by setting limit 1 here, we end up using very inefficient                                  // 124
  // code that recomputes the whole query on each update. The upside is                               // 125
  // that when you reactively depend on a findOne you only get                                        // 126
  // invalidated when the found object changes, not any object in the                                 // 127
  // collection. Most findOne will be by id, which has a fast path, so                                // 128
  // this might not be a big deal. In most cases, invalidation causes                                 // 129
  // the called to re-query anyway, so this should be a net performance                               // 130
  // improvement.                                                                                     // 131
  options = options || {};                                                                            // 132
  options.limit = 1;                                                                                  // 133
                                                                                                      // 134
  return this.find(selector, options).fetch()[0];                                                     // 135
};                                                                                                    // 136
                                                                                                      // 137
LocalCollection.Cursor.prototype.forEach = function (callback) {                                      // 138
  var self = this;                                                                                    // 139
  var doc;                                                                                            // 140
                                                                                                      // 141
  if (self.db_objects === null)                                                                       // 142
    self.db_objects = self._getRawObjects(true);                                                      // 143
                                                                                                      // 144
  if (self.reactive)                                                                                  // 145
    self._depend({                                                                                    // 146
      addedBefore: true,                                                                              // 147
      removed: true,                                                                                  // 148
      changed: true,                                                                                  // 149
      movedBefore: true});                                                                            // 150
                                                                                                      // 151
  while (self.cursor_pos < self.db_objects.length) {                                                  // 152
    var elt = EJSON.clone(self.db_objects[self.cursor_pos++]);                                        // 153
    if (self._transform)                                                                              // 154
      elt = self._transform(elt);                                                                     // 155
    callback(elt);                                                                                    // 156
  }                                                                                                   // 157
};                                                                                                    // 158
                                                                                                      // 159
LocalCollection.Cursor.prototype.getTransform = function () {                                         // 160
  var self = this;                                                                                    // 161
  return self._transform;                                                                             // 162
};                                                                                                    // 163
                                                                                                      // 164
LocalCollection.Cursor.prototype.map = function (callback) {                                          // 165
  var self = this;                                                                                    // 166
  var res = [];                                                                                       // 167
  self.forEach(function (doc) {                                                                       // 168
    res.push(callback(doc));                                                                          // 169
  });                                                                                                 // 170
  return res;                                                                                         // 171
};                                                                                                    // 172
                                                                                                      // 173
LocalCollection.Cursor.prototype.fetch = function () {                                                // 174
  var self = this;                                                                                    // 175
  var res = [];                                                                                       // 176
  self.forEach(function (doc) {                                                                       // 177
    res.push(doc);                                                                                    // 178
  });                                                                                                 // 179
  return res;                                                                                         // 180
};                                                                                                    // 181
                                                                                                      // 182
LocalCollection.Cursor.prototype.count = function () {                                                // 183
  var self = this;                                                                                    // 184
                                                                                                      // 185
  if (self.reactive)                                                                                  // 186
    self._depend({added: true, removed: true});                                                       // 187
                                                                                                      // 188
  if (self.db_objects === null)                                                                       // 189
    self.db_objects = self._getRawObjects(true);                                                      // 190
                                                                                                      // 191
  return self.db_objects.length;                                                                      // 192
};                                                                                                    // 193
                                                                                                      // 194
LocalCollection.Cursor.prototype._publishCursor = function (sub) {                                    // 195
  var self = this;                                                                                    // 196
  if (! self.collection.name)                                                                         // 197
    throw new Error("Can't publish a cursor from a collection without a name.");                      // 198
  var collection = self.collection.name;                                                              // 199
                                                                                                      // 200
  // XXX minimongo should not depend on mongo-livedata!                                               // 201
  return Meteor.Collection._publishCursor(self, sub, collection);                                     // 202
};                                                                                                    // 203
                                                                                                      // 204
LocalCollection._isOrderedChanges = function (callbacks) {                                            // 205
  if (callbacks.added && callbacks.addedBefore)                                                       // 206
    throw new Error("Please specify only one of added() and addedBefore()");                          // 207
  return typeof callbacks.addedBefore == 'function' ||                                                // 208
    typeof callbacks.movedBefore === 'function';                                                      // 209
};                                                                                                    // 210
                                                                                                      // 211
// the handle that comes back from observe.                                                           // 212
LocalCollection.LiveResultsSet = function () {};                                                      // 213
                                                                                                      // 214
// options to contain:                                                                                // 215
//  * callbacks for observe():                                                                        // 216
//    - addedAt (document, atIndex)                                                                   // 217
//    - added (document)                                                                              // 218
//    - changedAt (newDocument, oldDocument, atIndex)                                                 // 219
//    - changed (newDocument, oldDocument)                                                            // 220
//    - removedAt (document, atIndex)                                                                 // 221
//    - removed (document)                                                                            // 222
//    - movedTo (document, oldIndex, newIndex)                                                        // 223
//                                                                                                    // 224
// attributes available on returned query handle:                                                     // 225
//  * stop(): end updates                                                                             // 226
//  * collection: the collection this query is querying                                               // 227
//                                                                                                    // 228
// iff x is a returned query handle, (x instanceof                                                    // 229
// LocalCollection.LiveResultsSet) is true                                                            // 230
//                                                                                                    // 231
// initial results delivered through added callback                                                   // 232
// XXX maybe callbacks should take a list of objects, to expose transactions?                         // 233
// XXX maybe support field limiting (to limit what you're notified on)                                // 234
                                                                                                      // 235
_.extend(LocalCollection.Cursor.prototype, {                                                          // 236
  observe: function (options) {                                                                       // 237
    var self = this;                                                                                  // 238
    return LocalCollection._observeFromObserveChanges(self, options);                                 // 239
  },                                                                                                  // 240
  observeChanges: function (options) {                                                                // 241
    var self = this;                                                                                  // 242
                                                                                                      // 243
    var ordered = LocalCollection._isOrderedChanges(options);                                         // 244
                                                                                                      // 245
    if (!ordered && (self.skip || self.limit))                                                        // 246
      throw new Error("must use ordered observe with skip or limit");                                 // 247
                                                                                                      // 248
    // XXX merge this object w/ "this" Cursor.  they're the same.                                     // 249
    var query = {                                                                                     // 250
      selector_f: self.selector_f, // not fast pathed                                                 // 251
      sort_f: ordered && self.sort_f,                                                                 // 252
      results_snapshot: null,                                                                         // 253
      ordered: ordered,                                                                               // 254
      cursor: this,                                                                                   // 255
      observeChanges: options.observeChanges                                                          // 256
    };                                                                                                // 257
    var qid;                                                                                          // 258
                                                                                                      // 259
    // Non-reactive queries call added[Before] and then never call anything                           // 260
    // else.                                                                                          // 261
    if (self.reactive) {                                                                              // 262
      qid = self.collection.next_qid++;                                                               // 263
      self.collection.queries[qid] = query;                                                           // 264
    }                                                                                                 // 265
    query.results = self._getRawObjects(ordered);                                                     // 266
    if (self.collection.paused)                                                                       // 267
      query.results_snapshot = (ordered ? [] : {});                                                   // 268
                                                                                                      // 269
    // wrap callbacks we were passed. callbacks only fire when not paused and                         // 270
    // are never undefined (except that query.moved is undefined for unordered                        // 271
    // callbacks).                                                                                    // 272
                                                                                                      // 273
    // furthermore, callbacks enqueue until the operation we're working on is                         // 274
    // done.                                                                                          // 275
    var wrapCallback = function (f) {                                                                 // 276
      if (!f)                                                                                         // 277
        return function () {};                                                                        // 278
      return function (/*args*/) {                                                                    // 279
        var context = this;                                                                           // 280
        var args = arguments;                                                                         // 281
        if (!self.collection.paused) {                                                                // 282
          self.collection._observeQueue.queueTask(function () {                                       // 283
            f.apply(context, args);                                                                   // 284
          });                                                                                         // 285
        }                                                                                             // 286
      };                                                                                              // 287
    };                                                                                                // 288
    query.added = wrapCallback(options.added);                                                        // 289
    query.changed = wrapCallback(options.changed);                                                    // 290
    query.removed = wrapCallback(options.removed);                                                    // 291
    if (ordered) {                                                                                    // 292
      query.moved = wrapCallback(options.moved);                                                      // 293
      query.addedBefore = wrapCallback(options.addedBefore);                                          // 294
      query.movedBefore = wrapCallback(options.movedBefore);                                          // 295
    }                                                                                                 // 296
                                                                                                      // 297
    if (!options._suppress_initial && !self.collection.paused) {                                      // 298
      _.each(query.results, function (doc, i) {                                                       // 299
        var fields = EJSON.clone(doc);                                                                // 300
        delete fields._id;                                                                            // 301
        if (ordered)                                                                                  // 302
          query.addedBefore(doc._id, fields, null);                                                   // 303
        query.added(doc._id, fields);                                                                 // 304
      });                                                                                             // 305
    }                                                                                                 // 306
                                                                                                      // 307
    var handle = new LocalCollection.LiveResultsSet;                                                  // 308
    _.extend(handle, {                                                                                // 309
      collection: self.collection,                                                                    // 310
      stop: function () {                                                                             // 311
        if (self.reactive)                                                                            // 312
          delete self.collection.queries[qid];                                                        // 313
      }                                                                                               // 314
    });                                                                                               // 315
                                                                                                      // 316
    if (self.reactive && Deps.active) {                                                               // 317
      // XXX in many cases, the same observe will be recreated when                                   // 318
      // the current autorun is rerun.  we could save work by                                         // 319
      // letting it linger across rerun and potentially get                                           // 320
      // repurposed if the same observe is performed, using logic                                     // 321
      // similar to that of Meteor.subscribe.                                                         // 322
      Deps.onInvalidate(function () {                                                                 // 323
        handle.stop();                                                                                // 324
      });                                                                                             // 325
    }                                                                                                 // 326
    // run the observe callbacks resulting from the initial contents                                  // 327
    // before we leave the observe.                                                                   // 328
    self.collection._observeQueue.drain();                                                            // 329
                                                                                                      // 330
    return handle;                                                                                    // 331
  }                                                                                                   // 332
});                                                                                                   // 333
                                                                                                      // 334
// Returns a collection of matching objects, but doesn't deep copy them.                              // 335
//                                                                                                    // 336
// If ordered is set, returns a sorted array, respecting sort_f, skip, and limit                      // 337
// properties of the query.  if sort_f is falsey, no sort -- you get the natural                      // 338
// order.                                                                                             // 339
//                                                                                                    // 340
// If ordered is not set, returns an object mapping from ID to doc (sort_f, skip                      // 341
// and limit should not be set).                                                                      // 342
LocalCollection.Cursor.prototype._getRawObjects = function (ordered) {                                // 343
  var self = this;                                                                                    // 344
                                                                                                      // 345
  var results = ordered ? [] : {};                                                                    // 346
                                                                                                      // 347
  // fast path for single ID value                                                                    // 348
  if (self.selector_id) {                                                                             // 349
    // If you have non-zero skip and ask for a single id, you get                                     // 350
    // nothing. This is so it matches the behavior of the '{_id: foo}'                                // 351
    // path.                                                                                          // 352
    if (self.skip)                                                                                    // 353
      return results;                                                                                 // 354
                                                                                                      // 355
    if (_.has(self.collection.docs, self.selector_id)) {                                              // 356
      var selectedDoc = self.collection.docs[self.selector_id];                                       // 357
      if (ordered)                                                                                    // 358
        results.push(selectedDoc);                                                                    // 359
      else                                                                                            // 360
        results[self.selector_id] = selectedDoc;                                                      // 361
    }                                                                                                 // 362
    return results;                                                                                   // 363
  }                                                                                                   // 364
                                                                                                      // 365
  // slow path for arbitrary selector, sort, skip, limit                                              // 366
  for (var id in self.collection.docs) {                                                              // 367
    var doc = self.collection.docs[id];                                                               // 368
    if (self.selector_f(doc)) {                                                                       // 369
      if (ordered)                                                                                    // 370
        results.push(doc);                                                                            // 371
      else                                                                                            // 372
        results[id] = doc;                                                                            // 373
    }                                                                                                 // 374
    // Fast path for limited unsorted queries.                                                        // 375
    if (self.limit && !self.skip && !self.sort_f &&                                                   // 376
        results.length === self.limit)                                                                // 377
      return results;                                                                                 // 378
  }                                                                                                   // 379
                                                                                                      // 380
  if (!ordered)                                                                                       // 381
    return results;                                                                                   // 382
                                                                                                      // 383
  if (self.sort_f)                                                                                    // 384
    results.sort(self.sort_f);                                                                        // 385
                                                                                                      // 386
  var idx_start = self.skip || 0;                                                                     // 387
  var idx_end = self.limit ? (self.limit + idx_start) : results.length;                               // 388
  return results.slice(idx_start, idx_end);                                                           // 389
};                                                                                                    // 390
                                                                                                      // 391
// XXX Maybe we need a version of observe that just calls a callback if                               // 392
// anything changed.                                                                                  // 393
LocalCollection.Cursor.prototype._depend = function (changers) {                                      // 394
  var self = this;                                                                                    // 395
                                                                                                      // 396
  if (Deps.active) {                                                                                  // 397
    var v = new Deps.Dependency;                                                                      // 398
    v.depend();                                                                                       // 399
    var notifyChange = _.bind(v.changed, v);                                                          // 400
                                                                                                      // 401
    var options = {_suppress_initial: true};                                                          // 402
    _.each(['added', 'changed', 'removed', 'addedBefore', 'movedBefore'],                             // 403
           function (fnName) {                                                                        // 404
             if (changers[fnName])                                                                    // 405
               options[fnName] = notifyChange;                                                        // 406
           });                                                                                        // 407
                                                                                                      // 408
    // observeChanges will stop() when this computation is invalidated                                // 409
    self.observeChanges(options);                                                                     // 410
  }                                                                                                   // 411
};                                                                                                    // 412
                                                                                                      // 413
// XXX enforce rule that field names can't start with '$' or contain '.'                              // 414
// (real mongodb does in fact enforce this)                                                           // 415
// XXX possibly enforce that 'undefined' does not appear (we assume                                   // 416
// this in our handling of null and $exists)                                                          // 417
LocalCollection.prototype.insert = function (doc, callback) {                                         // 418
  var self = this;                                                                                    // 419
  doc = EJSON.clone(doc);                                                                             // 420
                                                                                                      // 421
  if (!_.has(doc, '_id')) {                                                                           // 422
    // if you really want to use ObjectIDs, set this global.                                          // 423
    // Meteor.Collection specifies its own ids and does not use this code.                            // 424
    doc._id = LocalCollection._useOID ? new LocalCollection._ObjectID()                               // 425
                                      : Random.id();                                                  // 426
  }                                                                                                   // 427
  var id = LocalCollection._idStringify(doc._id);                                                     // 428
                                                                                                      // 429
  if (_.has(self.docs, doc._id))                                                                      // 430
    throw MinimongoError("Duplicate _id '" + doc._id + "'");                                          // 431
                                                                                                      // 432
  self._saveOriginal(id, undefined);                                                                  // 433
  self.docs[id] = doc;                                                                                // 434
                                                                                                      // 435
  var queriesToRecompute = [];                                                                        // 436
  // trigger live queries that match                                                                  // 437
  for (var qid in self.queries) {                                                                     // 438
    var query = self.queries[qid];                                                                    // 439
    if (query.selector_f(doc)) {                                                                      // 440
      if (query.cursor.skip || query.cursor.limit)                                                    // 441
        queriesToRecompute.push(qid);                                                                 // 442
      else                                                                                            // 443
        LocalCollection._insertInResults(query, doc);                                                 // 444
    }                                                                                                 // 445
  }                                                                                                   // 446
                                                                                                      // 447
  _.each(queriesToRecompute, function (qid) {                                                         // 448
    if (self.queries[qid])                                                                            // 449
      LocalCollection._recomputeResults(self.queries[qid]);                                           // 450
  });                                                                                                 // 451
  self._observeQueue.drain();                                                                         // 452
  // Defer in case the callback returns on a future; gives the caller time to                         // 453
  // wait on the future.                                                                              // 454
  if (callback) Meteor.defer(function () { callback(null, doc._id); });                               // 455
  return doc._id;                                                                                     // 456
};                                                                                                    // 457
                                                                                                      // 458
LocalCollection.prototype.remove = function (selector, callback) {                                    // 459
  var self = this;                                                                                    // 460
  var remove = [];                                                                                    // 461
                                                                                                      // 462
  var queriesToRecompute = [];                                                                        // 463
  var selector_f = LocalCollection._compileSelector(selector);                                        // 464
                                                                                                      // 465
  // Avoid O(n) for "remove a single doc by ID".                                                      // 466
  var specificIds = LocalCollection._idsMatchedBySelector(selector);                                  // 467
  if (specificIds) {                                                                                  // 468
    _.each(specificIds, function (id) {                                                               // 469
      var strId = LocalCollection._idStringify(id);                                                   // 470
      // We still have to run selector_f, in case it's something like                                 // 471
      //   {_id: "X", a: 42}                                                                          // 472
      if (_.has(self.docs, strId) && selector_f(self.docs[strId]))                                    // 473
        remove.push(strId);                                                                           // 474
    });                                                                                               // 475
  } else {                                                                                            // 476
    for (var id in self.docs) {                                                                       // 477
      var doc = self.docs[id];                                                                        // 478
      if (selector_f(doc)) {                                                                          // 479
        remove.push(id);                                                                              // 480
      }                                                                                               // 481
    }                                                                                                 // 482
  }                                                                                                   // 483
                                                                                                      // 484
  var queryRemove = [];                                                                               // 485
  for (var i = 0; i < remove.length; i++) {                                                           // 486
    var removeId = remove[i];                                                                         // 487
    var removeDoc = self.docs[removeId];                                                              // 488
    _.each(self.queries, function (query, qid) {                                                      // 489
      if (query.selector_f(removeDoc)) {                                                              // 490
        if (query.cursor.skip || query.cursor.limit)                                                  // 491
          queriesToRecompute.push(qid);                                                               // 492
        else                                                                                          // 493
          queryRemove.push({qid: qid, doc: removeDoc});                                               // 494
      }                                                                                               // 495
    });                                                                                               // 496
    self._saveOriginal(removeId, removeDoc);                                                          // 497
    delete self.docs[removeId];                                                                       // 498
  }                                                                                                   // 499
                                                                                                      // 500
  // run live query callbacks _after_ we've removed the documents.                                    // 501
  _.each(queryRemove, function (remove) {                                                             // 502
    var query = self.queries[remove.qid];                                                             // 503
    if (query)                                                                                        // 504
      LocalCollection._removeFromResults(query, remove.doc);                                          // 505
  });                                                                                                 // 506
  _.each(queriesToRecompute, function (qid) {                                                         // 507
    var query = self.queries[qid];                                                                    // 508
    if (query)                                                                                        // 509
      LocalCollection._recomputeResults(query);                                                       // 510
  });                                                                                                 // 511
  self._observeQueue.drain();                                                                         // 512
  // Defer in case the callback returns on a future; gives the caller time to                         // 513
  // wait on the future.                                                                              // 514
  if (callback) Meteor.defer(callback);                                                               // 515
};                                                                                                    // 516
                                                                                                      // 517
// XXX atomicity: if multi is true, and one modification fails, do                                    // 518
// we rollback the whole operation, or what?                                                          // 519
LocalCollection.prototype.update = function (selector, mod, options, callback) {                      // 520
  var self = this;                                                                                    // 521
  if (! callback && options instanceof Function) {                                                    // 522
    callback = options;                                                                               // 523
    options = null;                                                                                   // 524
  }                                                                                                   // 525
  if (!options) options = {};                                                                         // 526
                                                                                                      // 527
  if (options.upsert)                                                                                 // 528
    throw new Error("upsert not yet implemented");                                                    // 529
                                                                                                      // 530
  var selector_f = LocalCollection._compileSelector(selector);                                        // 531
                                                                                                      // 532
  // Save the original results of any query that we might need to                                     // 533
  // _recomputeResults on, because _modifyAndNotify will mutate the objects in                        // 534
  // it. (We don't need to save the original results of paused queries because                        // 535
  // they already have a results_snapshot and we won't be diffing in                                  // 536
  // _recomputeResults.)                                                                              // 537
  var qidToOriginalResults = {};                                                                      // 538
  _.each(self.queries, function (query, qid) {                                                        // 539
    if ((query.cursor.skip || query.cursor.limit) && !query.paused)                                   // 540
      qidToOriginalResults[qid] = EJSON.clone(query.results);                                         // 541
  });                                                                                                 // 542
  var recomputeQids = {};                                                                             // 543
                                                                                                      // 544
  for (var id in self.docs) {                                                                         // 545
    var doc = self.docs[id];                                                                          // 546
    if (selector_f(doc)) {                                                                            // 547
      // XXX Should we save the original even if mod ends up being a no-op?                           // 548
      self._saveOriginal(id, doc);                                                                    // 549
      self._modifyAndNotify(doc, mod, recomputeQids);                                                 // 550
      if (!options.multi)                                                                             // 551
        break;                                                                                        // 552
    }                                                                                                 // 553
  }                                                                                                   // 554
                                                                                                      // 555
  _.each(recomputeQids, function (dummy, qid) {                                                       // 556
    var query = self.queries[qid];                                                                    // 557
    if (query)                                                                                        // 558
      LocalCollection._recomputeResults(query,                                                        // 559
                                        qidToOriginalResults[qid]);                                   // 560
  });                                                                                                 // 561
  self._observeQueue.drain();                                                                         // 562
  // Defer in case the callback returns on a future; gives the caller time to                         // 563
  // wait on the future.                                                                              // 564
  if (callback) Meteor.defer(callback);                                                               // 565
};                                                                                                    // 566
                                                                                                      // 567
LocalCollection.prototype._modifyAndNotify = function (                                               // 568
    doc, mod, recomputeQids) {                                                                        // 569
  var self = this;                                                                                    // 570
                                                                                                      // 571
  var matched_before = {};                                                                            // 572
  for (var qid in self.queries) {                                                                     // 573
    var query = self.queries[qid];                                                                    // 574
    if (query.ordered) {                                                                              // 575
      matched_before[qid] = query.selector_f(doc);                                                    // 576
    } else {                                                                                          // 577
      // Because we don't support skip or limit (yet) in unordered queries, we                        // 578
      // can just do a direct lookup.                                                                 // 579
      matched_before[qid] = _.has(query.results,                                                      // 580
                                  LocalCollection._idStringify(doc._id));                             // 581
    }                                                                                                 // 582
  }                                                                                                   // 583
                                                                                                      // 584
  var old_doc = EJSON.clone(doc);                                                                     // 585
                                                                                                      // 586
  LocalCollection._modify(doc, mod);                                                                  // 587
                                                                                                      // 588
  for (qid in self.queries) {                                                                         // 589
    query = self.queries[qid];                                                                        // 590
    var before = matched_before[qid];                                                                 // 591
    var after = query.selector_f(doc);                                                                // 592
                                                                                                      // 593
    if (query.cursor.skip || query.cursor.limit) {                                                    // 594
      // We need to recompute any query where the doc may have been in the                            // 595
      // cursor's window either before or after the update. (Note that if skip                        // 596
      // or limit is set, "before" and "after" being true do not necessarily                          // 597
      // mean that the document is in the cursor's output after skip/limit is                         // 598
      // applied... but if they are false, then the document definitely is NOT                        // 599
      // in the output. So it's safe to skip recompute if neither before or                           // 600
      // after are true.)                                                                             // 601
      if (before || after)                                                                            // 602
	recomputeQids[qid] = true;                                                                           // 603
    } else if (before && !after) {                                                                    // 604
      LocalCollection._removeFromResults(query, doc);                                                 // 605
    } else if (!before && after) {                                                                    // 606
      LocalCollection._insertInResults(query, doc);                                                   // 607
    } else if (before && after) {                                                                     // 608
      LocalCollection._updateInResults(query, doc, old_doc);                                          // 609
    }                                                                                                 // 610
  }                                                                                                   // 611
};                                                                                                    // 612
                                                                                                      // 613
// XXX the sorted-query logic below is laughably inefficient. we'll                                   // 614
// need to come up with a better datastructure for this.                                              // 615
//                                                                                                    // 616
// XXX the logic for observing with a skip or a limit is even more                                    // 617
// laughably inefficient. we recompute the whole results every time!                                  // 618
                                                                                                      // 619
LocalCollection._insertInResults = function (query, doc) {                                            // 620
  var fields = EJSON.clone(doc);                                                                      // 621
  delete fields._id;                                                                                  // 622
  if (query.ordered) {                                                                                // 623
    if (!query.sort_f) {                                                                              // 624
      query.addedBefore(doc._id, fields, null);                                                       // 625
      query.results.push(doc);                                                                        // 626
    } else {                                                                                          // 627
      var i = LocalCollection._insertInSortedList(                                                    // 628
        query.sort_f, query.results, doc);                                                            // 629
      var next = query.results[i+1];                                                                  // 630
      if (next)                                                                                       // 631
        next = next._id;                                                                              // 632
      else                                                                                            // 633
        next = null;                                                                                  // 634
      query.addedBefore(doc._id, fields, next);                                                       // 635
    }                                                                                                 // 636
    query.added(doc._id, fields);                                                                     // 637
  } else {                                                                                            // 638
    query.added(doc._id, fields);                                                                     // 639
    query.results[LocalCollection._idStringify(doc._id)] = doc;                                       // 640
  }                                                                                                   // 641
};                                                                                                    // 642
                                                                                                      // 643
LocalCollection._removeFromResults = function (query, doc) {                                          // 644
  if (query.ordered) {                                                                                // 645
    var i = LocalCollection._findInOrderedResults(query, doc);                                        // 646
    query.removed(doc._id);                                                                           // 647
    query.results.splice(i, 1);                                                                       // 648
  } else {                                                                                            // 649
    var id = LocalCollection._idStringify(doc._id);  // in case callback mutates doc                  // 650
    query.removed(doc._id);                                                                           // 651
    delete query.results[id];                                                                         // 652
  }                                                                                                   // 653
};                                                                                                    // 654
                                                                                                      // 655
LocalCollection._updateInResults = function (query, doc, old_doc) {                                   // 656
  if (!EJSON.equals(doc._id, old_doc._id))                                                            // 657
    throw new Error("Can't change a doc's _id while updating");                                       // 658
  var changedFields = LocalCollection._makeChangedFields(doc, old_doc);                               // 659
  if (!query.ordered) {                                                                               // 660
    if (!_.isEmpty(changedFields)) {                                                                  // 661
      query.changed(doc._id, changedFields);                                                          // 662
      query.results[LocalCollection._idStringify(doc._id)] = doc;                                     // 663
    }                                                                                                 // 664
    return;                                                                                           // 665
  }                                                                                                   // 666
                                                                                                      // 667
  var orig_idx = LocalCollection._findInOrderedResults(query, doc);                                   // 668
                                                                                                      // 669
  if (!_.isEmpty(changedFields))                                                                      // 670
    query.changed(doc._id, changedFields);                                                            // 671
  if (!query.sort_f)                                                                                  // 672
    return;                                                                                           // 673
                                                                                                      // 674
  // just take it out and put it back in again, and see if the index                                  // 675
  // changes                                                                                          // 676
  query.results.splice(orig_idx, 1);                                                                  // 677
  var new_idx = LocalCollection._insertInSortedList(                                                  // 678
    query.sort_f, query.results, doc);                                                                // 679
  if (orig_idx !== new_idx) {                                                                         // 680
    var next = query.results[new_idx+1];                                                              // 681
    if (next)                                                                                         // 682
      next = next._id;                                                                                // 683
    else                                                                                              // 684
      next = null;                                                                                    // 685
    query.movedBefore && query.movedBefore(doc._id, next);                                            // 686
  }                                                                                                   // 687
};                                                                                                    // 688
                                                                                                      // 689
// Recomputes the results of a query and runs observe callbacks for the                               // 690
// difference between the previous results and the current results (unless                            // 691
// paused). Used for skip/limit queries.                                                              // 692
//                                                                                                    // 693
// When this is used by insert or remove, it can just use query.results for the                       // 694
// old results (and there's no need to pass in oldResults), because these                             // 695
// operations don't mutate the documents in the collection. Update needs to pass                      // 696
// in an oldResults which was deep-copied before the modifier was applied.                            // 697
LocalCollection._recomputeResults = function (query, oldResults) {                                    // 698
  if (!oldResults)                                                                                    // 699
    oldResults = query.results;                                                                       // 700
  query.results = query.cursor._getRawObjects(query.ordered);                                         // 701
                                                                                                      // 702
  if (!query.paused) {                                                                                // 703
    LocalCollection._diffQueryChanges(                                                                // 704
      query.ordered, oldResults, query.results, query);                                               // 705
  }                                                                                                   // 706
};                                                                                                    // 707
                                                                                                      // 708
                                                                                                      // 709
LocalCollection._findInOrderedResults = function (query, doc) {                                       // 710
  if (!query.ordered)                                                                                 // 711
    throw new Error("Can't call _findInOrderedResults on unordered query");                           // 712
  for (var i = 0; i < query.results.length; i++)                                                      // 713
    if (query.results[i] === doc)                                                                     // 714
      return i;                                                                                       // 715
  throw Error("object missing from query");                                                           // 716
};                                                                                                    // 717
                                                                                                      // 718
// This binary search puts a value between any equal values, and the first                            // 719
// lesser value.                                                                                      // 720
LocalCollection._binarySearch = function (cmp, array, value) {                                        // 721
  var first = 0, rangeLength = array.length;                                                          // 722
                                                                                                      // 723
  while (rangeLength > 0) {                                                                           // 724
    var halfRange = Math.floor(rangeLength/2);                                                        // 725
    if (cmp(value, array[first + halfRange]) >= 0) {                                                  // 726
      first += halfRange + 1;                                                                         // 727
      rangeLength -= halfRange + 1;                                                                   // 728
    } else {                                                                                          // 729
      rangeLength = halfRange;                                                                        // 730
    }                                                                                                 // 731
  }                                                                                                   // 732
  return first;                                                                                       // 733
};                                                                                                    // 734
                                                                                                      // 735
LocalCollection._insertInSortedList = function (cmp, array, value) {                                  // 736
  if (array.length === 0) {                                                                           // 737
    array.push(value);                                                                                // 738
    return 0;                                                                                         // 739
  }                                                                                                   // 740
                                                                                                      // 741
  var idx = LocalCollection._binarySearch(cmp, array, value);                                         // 742
  array.splice(idx, 0, value);                                                                        // 743
  return idx;                                                                                         // 744
};                                                                                                    // 745
                                                                                                      // 746
// To track what documents are affected by a piece of code, call saveOriginals()                      // 747
// before it and retrieveOriginals() after it. retrieveOriginals returns an                           // 748
// object whose keys are the ids of the documents that were affected since the                        // 749
// call to saveOriginals(), and the values are equal to the document's contents                       // 750
// at the time of saveOriginals. (In the case of an inserted document, undefined                      // 751
// is the value.) You must alternate between calls to saveOriginals() and                             // 752
// retrieveOriginals().                                                                               // 753
LocalCollection.prototype.saveOriginals = function () {                                               // 754
  var self = this;                                                                                    // 755
  if (self._savedOriginals)                                                                           // 756
    throw new Error("Called saveOriginals twice without retrieveOriginals");                          // 757
  self._savedOriginals = {};                                                                          // 758
};                                                                                                    // 759
LocalCollection.prototype.retrieveOriginals = function () {                                           // 760
  var self = this;                                                                                    // 761
  if (!self._savedOriginals)                                                                          // 762
    throw new Error("Called retrieveOriginals without saveOriginals");                                // 763
                                                                                                      // 764
  var originals = self._savedOriginals;                                                               // 765
  self._savedOriginals = null;                                                                        // 766
  return originals;                                                                                   // 767
};                                                                                                    // 768
                                                                                                      // 769
LocalCollection.prototype._saveOriginal = function (id, doc) {                                        // 770
  var self = this;                                                                                    // 771
  // Are we even trying to save originals?                                                            // 772
  if (!self._savedOriginals)                                                                          // 773
    return;                                                                                           // 774
  // Have we previously mutated the original (and so 'doc' is not actually                            // 775
  // original)?  (Note the 'has' check rather than truth: we store undefined                          // 776
  // here for inserted docs!)                                                                         // 777
  if (_.has(self._savedOriginals, id))                                                                // 778
    return;                                                                                           // 779
  self._savedOriginals[id] = EJSON.clone(doc);                                                        // 780
};                                                                                                    // 781
                                                                                                      // 782
// Pause the observers. No callbacks from observers will fire until                                   // 783
// 'resumeObservers' is called.                                                                       // 784
LocalCollection.prototype.pauseObservers = function () {                                              // 785
  // No-op if already paused.                                                                         // 786
  if (this.paused)                                                                                    // 787
    return;                                                                                           // 788
                                                                                                      // 789
  // Set the 'paused' flag such that new observer messages don't fire.                                // 790
  this.paused = true;                                                                                 // 791
                                                                                                      // 792
  // Take a snapshot of the query results for each query.                                             // 793
  for (var qid in this.queries) {                                                                     // 794
    var query = this.queries[qid];                                                                    // 795
                                                                                                      // 796
    query.results_snapshot = EJSON.clone(query.results);                                              // 797
  }                                                                                                   // 798
};                                                                                                    // 799
                                                                                                      // 800
// Resume the observers. Observers immediately receive change                                         // 801
// notifications to bring them to the current state of the                                            // 802
// database. Note that this is not just replaying all the changes that                                // 803
// happened during the pause, it is a smarter 'coalesced' diff.                                       // 804
LocalCollection.prototype.resumeObservers = function () {                                             // 805
  var self = this;                                                                                    // 806
  // No-op if not paused.                                                                             // 807
  if (!this.paused)                                                                                   // 808
    return;                                                                                           // 809
                                                                                                      // 810
  // Unset the 'paused' flag. Make sure to do this first, otherwise                                   // 811
  // observer methods won't actually fire when we trigger them.                                       // 812
  this.paused = false;                                                                                // 813
                                                                                                      // 814
  for (var qid in this.queries) {                                                                     // 815
    var query = self.queries[qid];                                                                    // 816
    // Diff the current results against the snapshot and send to observers.                           // 817
    // pass the query object for its observer callbacks.                                              // 818
    LocalCollection._diffQueryChanges(                                                                // 819
      query.ordered, query.results_snapshot, query.results, query);                                   // 820
    query.results_snapshot = null;                                                                    // 821
  }                                                                                                   // 822
  self._observeQueue.drain();                                                                         // 823
};                                                                                                    // 824
                                                                                                      // 825
                                                                                                      // 826
// NB: used by livedata                                                                               // 827
LocalCollection._idStringify = function (id) {                                                        // 828
  if (id instanceof LocalCollection._ObjectID) {                                                      // 829
    return id.valueOf();                                                                              // 830
  } else if (typeof id === 'string') {                                                                // 831
    if (id === "") {                                                                                  // 832
      return id;                                                                                      // 833
    } else if (id.substr(0, 1) === "-" || // escape previously dashed strings                         // 834
               id.substr(0, 1) === "~" || // escape escaped numbers, true, false                      // 835
               LocalCollection._looksLikeObjectID(id) || // escape object-id-form strings             // 836
               id.substr(0, 1) === '{') { // escape object-form strings, for maybe implementing later // 837
      return "-" + id;                                                                                // 838
    } else {                                                                                          // 839
      return id; // other strings go through unchanged.                                               // 840
    }                                                                                                 // 841
  } else if (id === undefined) {                                                                      // 842
    return '-';                                                                                       // 843
  } else if (typeof id === 'object' && id !== null) {                                                 // 844
    throw new Error("Meteor does not currently support objects other than ObjectID as ids");          // 845
  } else { // Numbers, true, false, null                                                              // 846
    return "~" + JSON.stringify(id);                                                                  // 847
  }                                                                                                   // 848
};                                                                                                    // 849
                                                                                                      // 850
                                                                                                      // 851
// NB: used by livedata                                                                               // 852
LocalCollection._idParse = function (id) {                                                            // 853
  if (id === "") {                                                                                    // 854
    return id;                                                                                        // 855
  } else if (id === '-') {                                                                            // 856
    return undefined;                                                                                 // 857
  } else if (id.substr(0, 1) === '-') {                                                               // 858
    return id.substr(1);                                                                              // 859
  } else if (id.substr(0, 1) === '~') {                                                               // 860
    return JSON.parse(id.substr(1));                                                                  // 861
  } else if (LocalCollection._looksLikeObjectID(id)) {                                                // 862
    return new LocalCollection._ObjectID(id);                                                         // 863
  } else {                                                                                            // 864
    return id;                                                                                        // 865
  }                                                                                                   // 866
};                                                                                                    // 867
                                                                                                      // 868
LocalCollection._makeChangedFields = function (newDoc, oldDoc) {                                      // 869
  var fields = {};                                                                                    // 870
  LocalCollection._diffObjects(oldDoc, newDoc, {                                                      // 871
    leftOnly: function (key, value) {                                                                 // 872
      fields[key] = undefined;                                                                        // 873
    },                                                                                                // 874
    rightOnly: function (key, value) {                                                                // 875
      fields[key] = value;                                                                            // 876
    },                                                                                                // 877
    both: function (key, leftValue, rightValue) {                                                     // 878
      if (!EJSON.equals(leftValue, rightValue))                                                       // 879
        fields[key] = rightValue;                                                                     // 880
    }                                                                                                 // 881
  });                                                                                                 // 882
  return fields;                                                                                      // 883
};                                                                                                    // 884
                                                                                                      // 885
LocalCollection._observeFromObserveChanges = function (cursor, callbacks) {                           // 886
  var transform = cursor.getTransform();                                                              // 887
  if (!transform)                                                                                     // 888
    transform = function (doc) {return doc;};                                                         // 889
  if (callbacks.addedAt && callbacks.added)                                                           // 890
    throw new Error("Please specify only one of added() and addedAt()");                              // 891
  if (callbacks.changedAt && callbacks.changed)                                                       // 892
    throw new Error("Please specify only one of changed() and changedAt()");                          // 893
  if (callbacks.removed && callbacks.removedAt)                                                       // 894
    throw new Error("Please specify only one of removed() and removedAt()");                          // 895
  if (callbacks.addedAt || callbacks.movedTo ||                                                       // 896
      callbacks.changedAt || callbacks.removedAt)                                                     // 897
    return LocalCollection._observeOrderedFromObserveChanges(cursor, callbacks, transform);           // 898
  else                                                                                                // 899
    return LocalCollection._observeUnorderedFromObserveChanges(cursor, callbacks, transform);         // 900
};                                                                                                    // 901
                                                                                                      // 902
LocalCollection._observeUnorderedFromObserveChanges =                                                 // 903
    function (cursor, callbacks, transform) {                                                         // 904
  var docs = {};                                                                                      // 905
  var suppressed = !!callbacks._suppress_initial;                                                     // 906
  var handle = cursor.observeChanges({                                                                // 907
    added: function (id, fields) {                                                                    // 908
      var strId = LocalCollection._idStringify(id);                                                   // 909
      var doc = EJSON.clone(fields);                                                                  // 910
      doc._id = id;                                                                                   // 911
      docs[strId] = doc;                                                                              // 912
      suppressed || callbacks.added && callbacks.added(transform(doc));                               // 913
    },                                                                                                // 914
    changed: function (id, fields) {                                                                  // 915
      var strId = LocalCollection._idStringify(id);                                                   // 916
      var doc = docs[strId];                                                                          // 917
      var oldDoc = EJSON.clone(doc);                                                                  // 918
      // writes through to the doc set                                                                // 919
      LocalCollection._applyChanges(doc, fields);                                                     // 920
      suppressed || callbacks.changed && callbacks.changed(transform(doc), transform(oldDoc));        // 921
    },                                                                                                // 922
    removed: function (id) {                                                                          // 923
      var strId = LocalCollection._idStringify(id);                                                   // 924
      var doc = docs[strId];                                                                          // 925
      delete docs[strId];                                                                             // 926
      suppressed || callbacks.removed && callbacks.removed(transform(doc));                           // 927
    }                                                                                                 // 928
  });                                                                                                 // 929
  suppressed = false;                                                                                 // 930
  return handle;                                                                                      // 931
};                                                                                                    // 932
                                                                                                      // 933
LocalCollection._observeOrderedFromObserveChanges =                                                   // 934
    function (cursor, callbacks, transform) {                                                         // 935
  var docs = new OrderedDict(LocalCollection._idStringify);                                           // 936
  var suppressed = !!callbacks._suppress_initial;                                                     // 937
  // The "_no_indices" option sets all index arguments to -1                                          // 938
  // and skips the linear scans required to generate them.                                            // 939
  // This lets observers that don't need absolute indices                                             // 940
  // benefit from the other features of this API --                                                   // 941
  // relative order, transforms, and applyChanges -- without                                          // 942
  // the speed hit.                                                                                   // 943
  var indices = !callbacks._no_indices;                                                               // 944
  var handle = cursor.observeChanges({                                                                // 945
    addedBefore: function (id, fields, before) {                                                      // 946
      var doc = EJSON.clone(fields);                                                                  // 947
      doc._id = id;                                                                                   // 948
      // XXX could `before` be a falsy ID?  Technically                                               // 949
      // idStringify seems to allow for them -- though                                                // 950
      // OrderedDict won't call stringify on a falsy arg.                                             // 951
      docs.putBefore(id, doc, before || null);                                                        // 952
      if (!suppressed) {                                                                              // 953
        if (callbacks.addedAt) {                                                                      // 954
          var index = indices ? docs.indexOf(id) : -1;                                                // 955
          callbacks.addedAt(transform(EJSON.clone(doc)),                                              // 956
                            index, before);                                                           // 957
        } else if (callbacks.added) {                                                                 // 958
          callbacks.added(transform(EJSON.clone(doc)));                                               // 959
        }                                                                                             // 960
      }                                                                                               // 961
    },                                                                                                // 962
    changed: function (id, fields) {                                                                  // 963
      var doc = docs.get(id);                                                                         // 964
      if (!doc)                                                                                       // 965
        throw new Error("Unknown id for changed: " + id);                                             // 966
      var oldDoc = EJSON.clone(doc);                                                                  // 967
      // writes through to the doc set                                                                // 968
      LocalCollection._applyChanges(doc, fields);                                                     // 969
      if (callbacks.changedAt) {                                                                      // 970
        var index = indices ? docs.indexOf(id) : -1;                                                  // 971
        callbacks.changedAt(transform(EJSON.clone(doc)),                                              // 972
                            transform(oldDoc), index);                                                // 973
      } else if (callbacks.changed) {                                                                 // 974
        callbacks.changed(transform(EJSON.clone(doc)),                                                // 975
                          transform(oldDoc));                                                         // 976
      }                                                                                               // 977
    },                                                                                                // 978
    movedBefore: function (id, before) {                                                              // 979
      var doc = docs.get(id);                                                                         // 980
      var from;                                                                                       // 981
      // only capture indexes if we're going to call the callback that needs them.                    // 982
      if (callbacks.movedTo)                                                                          // 983
        from = indices ? docs.indexOf(id) : -1;                                                       // 984
      docs.moveBefore(id, before || null);                                                            // 985
      if (callbacks.movedTo) {                                                                        // 986
        var to = indices ? docs.indexOf(id) : -1;                                                     // 987
        callbacks.movedTo(transform(EJSON.clone(doc)), from, to,                                      // 988
                          before || null);                                                            // 989
      } else if (callbacks.moved) {                                                                   // 990
        callbacks.moved(transform(EJSON.clone(doc)));                                                 // 991
      }                                                                                               // 992
                                                                                                      // 993
    },                                                                                                // 994
    removed: function (id) {                                                                          // 995
      var doc = docs.get(id);                                                                         // 996
      var index;                                                                                      // 997
      if (callbacks.removedAt)                                                                        // 998
        index = indices ? docs.indexOf(id) : -1;                                                      // 999
      docs.remove(id);                                                                                // 1000
      callbacks.removedAt && callbacks.removedAt(transform(doc), index);                              // 1001
      callbacks.removed && callbacks.removed(transform(doc));                                         // 1002
    }                                                                                                 // 1003
  });                                                                                                 // 1004
  suppressed = false;                                                                                 // 1005
  return handle;                                                                                      // 1006
};                                                                                                    // 1007
                                                                                                      // 1008
////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                    //
// packages/minimongo/selector.js                                                                     //
//                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                      //
// Like _.isArray, but doesn't regard polyfilled Uint8Arrays on old browsers as                       // 1
// arrays.                                                                                            // 2
var isArray = function (x) {                                                                          // 3
  return _.isArray(x) && !EJSON.isBinary(x);                                                          // 4
};                                                                                                    // 5
                                                                                                      // 6
var _anyIfArray = function (x, f) {                                                                   // 7
  if (isArray(x))                                                                                     // 8
    return _.any(x, f);                                                                               // 9
  return f(x);                                                                                        // 10
};                                                                                                    // 11
                                                                                                      // 12
var _anyIfArrayPlus = function (x, f) {                                                               // 13
  if (f(x))                                                                                           // 14
    return true;                                                                                      // 15
  return isArray(x) && _.any(x, f);                                                                   // 16
};                                                                                                    // 17
                                                                                                      // 18
var hasOperators = function(valueSelector) {                                                          // 19
  var theseAreOperators = undefined;                                                                  // 20
  for (var selKey in valueSelector) {                                                                 // 21
    var thisIsOperator = selKey.substr(0, 1) === '$';                                                 // 22
    if (theseAreOperators === undefined) {                                                            // 23
      theseAreOperators = thisIsOperator;                                                             // 24
    } else if (theseAreOperators !== thisIsOperator) {                                                // 25
      throw new Error("Inconsistent selector: " + valueSelector);                                     // 26
    }                                                                                                 // 27
  }                                                                                                   // 28
  return !!theseAreOperators;  // {} has no operators                                                 // 29
};                                                                                                    // 30
                                                                                                      // 31
var compileValueSelector = function (valueSelector) {                                                 // 32
  if (valueSelector == null) {  // undefined or null                                                  // 33
    return function (value) {                                                                         // 34
      return _anyIfArray(value, function (x) {                                                        // 35
        return x == null;  // undefined or null                                                       // 36
      });                                                                                             // 37
    };                                                                                                // 38
  }                                                                                                   // 39
                                                                                                      // 40
  // Selector is a non-null primitive (and not an array or RegExp either).                            // 41
  if (!_.isObject(valueSelector)) {                                                                   // 42
    return function (value) {                                                                         // 43
      return _anyIfArray(value, function (x) {                                                        // 44
        return x === valueSelector;                                                                   // 45
      });                                                                                             // 46
    };                                                                                                // 47
  }                                                                                                   // 48
                                                                                                      // 49
  if (valueSelector instanceof RegExp) {                                                              // 50
    return function (value) {                                                                         // 51
      if (value === undefined)                                                                        // 52
        return false;                                                                                 // 53
      return _anyIfArray(value, function (x) {                                                        // 54
        return valueSelector.test(x);                                                                 // 55
      });                                                                                             // 56
    };                                                                                                // 57
  }                                                                                                   // 58
                                                                                                      // 59
  // Arrays match either identical arrays or arrays that contain it as a value.                       // 60
  if (isArray(valueSelector)) {                                                                       // 61
    return function (value) {                                                                         // 62
      if (!isArray(value))                                                                            // 63
        return false;                                                                                 // 64
      return _anyIfArrayPlus(value, function (x) {                                                    // 65
        return LocalCollection._f._equal(valueSelector, x);                                           // 66
      });                                                                                             // 67
    };                                                                                                // 68
  }                                                                                                   // 69
                                                                                                      // 70
  // It's an object, but not an array or regexp.                                                      // 71
  if (hasOperators(valueSelector)) {                                                                  // 72
    var operatorFunctions = [];                                                                       // 73
    _.each(valueSelector, function (operand, operator) {                                              // 74
      if (!_.has(VALUE_OPERATORS, operator))                                                          // 75
        throw new Error("Unrecognized operator: " + operator);                                        // 76
      operatorFunctions.push(VALUE_OPERATORS[operator](                                               // 77
        operand, valueSelector.$options));                                                            // 78
    });                                                                                               // 79
    return function (value) {                                                                         // 80
      return _.all(operatorFunctions, function (f) {                                                  // 81
        return f(value);                                                                              // 82
      });                                                                                             // 83
    };                                                                                                // 84
  }                                                                                                   // 85
                                                                                                      // 86
  // It's a literal; compare value (or element of value array) directly to the                        // 87
  // selector.                                                                                        // 88
  return function (value) {                                                                           // 89
    return _anyIfArray(value, function (x) {                                                          // 90
      return LocalCollection._f._equal(valueSelector, x);                                             // 91
    });                                                                                               // 92
  };                                                                                                  // 93
};                                                                                                    // 94
                                                                                                      // 95
// XXX can factor out common logic below                                                              // 96
var LOGICAL_OPERATORS = {                                                                             // 97
  "$and": function(subSelector) {                                                                     // 98
    if (!isArray(subSelector) || _.isEmpty(subSelector))                                              // 99
      throw Error("$and/$or/$nor must be nonempty array");                                            // 100
    var subSelectorFunctions = _.map(                                                                 // 101
      subSelector, compileDocumentSelector);                                                          // 102
    return function (doc) {                                                                           // 103
      return _.all(subSelectorFunctions, function (f) {                                               // 104
        return f(doc);                                                                                // 105
      });                                                                                             // 106
    };                                                                                                // 107
  },                                                                                                  // 108
                                                                                                      // 109
  "$or": function(subSelector) {                                                                      // 110
    if (!isArray(subSelector) || _.isEmpty(subSelector))                                              // 111
      throw Error("$and/$or/$nor must be nonempty array");                                            // 112
    var subSelectorFunctions = _.map(                                                                 // 113
      subSelector, compileDocumentSelector);                                                          // 114
    return function (doc) {                                                                           // 115
      return _.any(subSelectorFunctions, function (f) {                                               // 116
        return f(doc);                                                                                // 117
      });                                                                                             // 118
    };                                                                                                // 119
  },                                                                                                  // 120
                                                                                                      // 121
  "$nor": function(subSelector) {                                                                     // 122
    if (!isArray(subSelector) || _.isEmpty(subSelector))                                              // 123
      throw Error("$and/$or/$nor must be nonempty array");                                            // 124
    var subSelectorFunctions = _.map(                                                                 // 125
      subSelector, compileDocumentSelector);                                                          // 126
    return function (doc) {                                                                           // 127
      return _.all(subSelectorFunctions, function (f) {                                               // 128
        return !f(doc);                                                                               // 129
      });                                                                                             // 130
    };                                                                                                // 131
  },                                                                                                  // 132
                                                                                                      // 133
  "$where": function(selectorValue) {                                                                 // 134
    if (!(selectorValue instanceof Function)) {                                                       // 135
      selectorValue = Function("return " + selectorValue);                                            // 136
    }                                                                                                 // 137
    return function (doc) {                                                                           // 138
      return selectorValue.call(doc);                                                                 // 139
    };                                                                                                // 140
  }                                                                                                   // 141
};                                                                                                    // 142
                                                                                                      // 143
var VALUE_OPERATORS = {                                                                               // 144
  "$in": function (operand) {                                                                         // 145
    if (!isArray(operand))                                                                            // 146
      throw new Error("Argument to $in must be array");                                               // 147
    return function (value) {                                                                         // 148
      return _anyIfArrayPlus(value, function (x) {                                                    // 149
        return _.any(operand, function (operandElt) {                                                 // 150
          return LocalCollection._f._equal(operandElt, x);                                            // 151
        });                                                                                           // 152
      });                                                                                             // 153
    };                                                                                                // 154
  },                                                                                                  // 155
                                                                                                      // 156
  "$all": function (operand) {                                                                        // 157
    if (!isArray(operand))                                                                            // 158
      throw new Error("Argument to $all must be array");                                              // 159
    return function (value) {                                                                         // 160
      if (!isArray(value))                                                                            // 161
        return false;                                                                                 // 162
      return _.all(operand, function (operandElt) {                                                   // 163
        return _.any(value, function (valueElt) {                                                     // 164
          return LocalCollection._f._equal(operandElt, valueElt);                                     // 165
        });                                                                                           // 166
      });                                                                                             // 167
    };                                                                                                // 168
  },                                                                                                  // 169
                                                                                                      // 170
  "$lt": function (operand) {                                                                         // 171
    return function (value) {                                                                         // 172
      return _anyIfArray(value, function (x) {                                                        // 173
        return LocalCollection._f._cmp(x, operand) < 0;                                               // 174
      });                                                                                             // 175
    };                                                                                                // 176
  },                                                                                                  // 177
                                                                                                      // 178
  "$lte": function (operand) {                                                                        // 179
    return function (value) {                                                                         // 180
      return _anyIfArray(value, function (x) {                                                        // 181
        return LocalCollection._f._cmp(x, operand) <= 0;                                              // 182
      });                                                                                             // 183
    };                                                                                                // 184
  },                                                                                                  // 185
                                                                                                      // 186
  "$gt": function (operand) {                                                                         // 187
    return function (value) {                                                                         // 188
      return _anyIfArray(value, function (x) {                                                        // 189
        return LocalCollection._f._cmp(x, operand) > 0;                                               // 190
      });                                                                                             // 191
    };                                                                                                // 192
  },                                                                                                  // 193
                                                                                                      // 194
  "$gte": function (operand) {                                                                        // 195
    return function (value) {                                                                         // 196
      return _anyIfArray(value, function (x) {                                                        // 197
        return LocalCollection._f._cmp(x, operand) >= 0;                                              // 198
      });                                                                                             // 199
    };                                                                                                // 200
  },                                                                                                  // 201
                                                                                                      // 202
  "$ne": function (operand) {                                                                         // 203
    return function (value) {                                                                         // 204
      return ! _anyIfArrayPlus(value, function (x) {                                                  // 205
        return LocalCollection._f._equal(x, operand);                                                 // 206
      });                                                                                             // 207
    };                                                                                                // 208
  },                                                                                                  // 209
                                                                                                      // 210
  "$nin": function (operand) {                                                                        // 211
    if (!isArray(operand))                                                                            // 212
      throw new Error("Argument to $nin must be array");                                              // 213
    var inFunction = VALUE_OPERATORS.$in(operand);                                                    // 214
    return function (value) {                                                                         // 215
      // Field doesn't exist, so it's not-in operand                                                  // 216
      if (value === undefined)                                                                        // 217
        return true;                                                                                  // 218
      return !inFunction(value);                                                                      // 219
    };                                                                                                // 220
  },                                                                                                  // 221
                                                                                                      // 222
  "$exists": function (operand) {                                                                     // 223
    return function (value) {                                                                         // 224
      return operand === (value !== undefined);                                                       // 225
    };                                                                                                // 226
  },                                                                                                  // 227
                                                                                                      // 228
  "$mod": function (operand) {                                                                        // 229
    var divisor = operand[0],                                                                         // 230
        remainder = operand[1];                                                                       // 231
    return function (value) {                                                                         // 232
      return _anyIfArray(value, function (x) {                                                        // 233
        return x % divisor === remainder;                                                             // 234
      });                                                                                             // 235
    };                                                                                                // 236
  },                                                                                                  // 237
                                                                                                      // 238
  "$size": function (operand) {                                                                       // 239
    return function (value) {                                                                         // 240
      return isArray(value) && operand === value.length;                                              // 241
    };                                                                                                // 242
  },                                                                                                  // 243
                                                                                                      // 244
  "$type": function (operand) {                                                                       // 245
    return function (value) {                                                                         // 246
      // A nonexistent field is of no type.                                                           // 247
      if (value === undefined)                                                                        // 248
        return false;                                                                                 // 249
      // Definitely not _anyIfArrayPlus: $type: 4 only matches arrays that have                       // 250
      // arrays as elements according to the Mongo docs.                                              // 251
      return _anyIfArray(value, function (x) {                                                        // 252
        return LocalCollection._f._type(x) === operand;                                               // 253
      });                                                                                             // 254
    };                                                                                                // 255
  },                                                                                                  // 256
                                                                                                      // 257
  "$regex": function (operand, options) {                                                             // 258
    if (options !== undefined) {                                                                      // 259
      // Options passed in $options (even the empty string) always overrides                          // 260
      // options in the RegExp object itself. (See also                                               // 261
      // Meteor.Collection._rewriteSelector.)                                                         // 262
                                                                                                      // 263
      // Be clear that we only support the JS-supported options, not extended                         // 264
      // ones (eg, Mongo supports x and s). Ideally we would implement x and s                        // 265
      // by transforming the regexp, but not today...                                                 // 266
      if (/[^gim]/.test(options))                                                                     // 267
        throw new Error("Only the i, m, and g regexp options are supported");                         // 268
                                                                                                      // 269
      var regexSource = operand instanceof RegExp ? operand.source : operand;                         // 270
      operand = new RegExp(regexSource, options);                                                     // 271
    } else if (!(operand instanceof RegExp)) {                                                        // 272
      operand = new RegExp(operand);                                                                  // 273
    }                                                                                                 // 274
                                                                                                      // 275
    return function (value) {                                                                         // 276
      if (value === undefined)                                                                        // 277
        return false;                                                                                 // 278
      return _anyIfArray(value, function (x) {                                                        // 279
        return operand.test(x);                                                                       // 280
      });                                                                                             // 281
    };                                                                                                // 282
  },                                                                                                  // 283
                                                                                                      // 284
  "$options": function (operand) {                                                                    // 285
    // evaluation happens at the $regex function above                                                // 286
    return function (value) { return true; };                                                         // 287
  },                                                                                                  // 288
                                                                                                      // 289
  "$elemMatch": function (operand) {                                                                  // 290
    var matcher = compileDocumentSelector(operand);                                                   // 291
    return function (value) {                                                                         // 292
      if (!isArray(value))                                                                            // 293
        return false;                                                                                 // 294
      return _.any(value, function (x) {                                                              // 295
        return matcher(x);                                                                            // 296
      });                                                                                             // 297
    };                                                                                                // 298
  },                                                                                                  // 299
                                                                                                      // 300
  "$not": function (operand) {                                                                        // 301
    var matcher = compileValueSelector(operand);                                                      // 302
    return function (value) {                                                                         // 303
      return !matcher(value);                                                                         // 304
    };                                                                                                // 305
  }                                                                                                   // 306
};                                                                                                    // 307
                                                                                                      // 308
// helpers used by compiled selector code                                                             // 309
LocalCollection._f = {                                                                                // 310
  // XXX for _all and _in, consider building 'inquery' at compile time..                              // 311
                                                                                                      // 312
  _type: function (v) {                                                                               // 313
    if (typeof v === "number")                                                                        // 314
      return 1;                                                                                       // 315
    if (typeof v === "string")                                                                        // 316
      return 2;                                                                                       // 317
    if (typeof v === "boolean")                                                                       // 318
      return 8;                                                                                       // 319
    if (isArray(v))                                                                                   // 320
      return 4;                                                                                       // 321
    if (v === null)                                                                                   // 322
      return 10;                                                                                      // 323
    if (v instanceof RegExp)                                                                          // 324
      return 11;                                                                                      // 325
    if (typeof v === "function")                                                                      // 326
      // note that typeof(/x/) === "function"                                                         // 327
      return 13;                                                                                      // 328
    if (v instanceof Date)                                                                            // 329
      return 9;                                                                                       // 330
    if (EJSON.isBinary(v))                                                                            // 331
      return 5;                                                                                       // 332
    if (v instanceof LocalCollection._ObjectID)                                                       // 333
      return 7;                                                                                       // 334
    return 3; // object                                                                               // 335
                                                                                                      // 336
    // XXX support some/all of these:                                                                 // 337
    // 14, symbol                                                                                     // 338
    // 15, javascript code with scope                                                                 // 339
    // 16, 18: 32-bit/64-bit integer                                                                  // 340
    // 17, timestamp                                                                                  // 341
    // 255, minkey                                                                                    // 342
    // 127, maxkey                                                                                    // 343
  },                                                                                                  // 344
                                                                                                      // 345
  // deep equality test: use for literal document and array matches                                   // 346
  _equal: function (a, b) {                                                                           // 347
    return EJSON.equals(a, b, {keyOrderSensitive: true});                                             // 348
  },                                                                                                  // 349
                                                                                                      // 350
  // maps a type code to a value that can be used to sort values of                                   // 351
  // different types                                                                                  // 352
  _typeorder: function (t) {                                                                          // 353
    // http://www.mongodb.org/display/DOCS/What+is+the+Compare+Order+for+BSON+Types                   // 354
    // XXX what is the correct sort position for Javascript code?                                     // 355
    // ('100' in the matrix below)                                                                    // 356
    // XXX minkey/maxkey                                                                              // 357
    return [-1,  // (not a type)                                                                      // 358
            1,   // number                                                                            // 359
            2,   // string                                                                            // 360
            3,   // object                                                                            // 361
            4,   // array                                                                             // 362
            5,   // binary                                                                            // 363
            -1,  // deprecated                                                                        // 364
            6,   // ObjectID                                                                          // 365
            7,   // bool                                                                              // 366
            8,   // Date                                                                              // 367
            0,   // null                                                                              // 368
            9,   // RegExp                                                                            // 369
            -1,  // deprecated                                                                        // 370
            100, // JS code                                                                           // 371
            2,   // deprecated (symbol)                                                               // 372
            100, // JS code                                                                           // 373
            1,   // 32-bit int                                                                        // 374
            8,   // Mongo timestamp                                                                   // 375
            1    // 64-bit int                                                                        // 376
           ][t];                                                                                      // 377
  },                                                                                                  // 378
                                                                                                      // 379
  // compare two values of unknown type according to BSON ordering                                    // 380
  // semantics. (as an extension, consider 'undefined' to be less than                                // 381
  // any other value.) return negative if a is less, positive if b is                                 // 382
  // less, or 0 if equal                                                                              // 383
  _cmp: function (a, b) {                                                                             // 384
    if (a === undefined)                                                                              // 385
      return b === undefined ? 0 : -1;                                                                // 386
    if (b === undefined)                                                                              // 387
      return 1;                                                                                       // 388
    var ta = LocalCollection._f._type(a);                                                             // 389
    var tb = LocalCollection._f._type(b);                                                             // 390
    var oa = LocalCollection._f._typeorder(ta);                                                       // 391
    var ob = LocalCollection._f._typeorder(tb);                                                       // 392
    if (oa !== ob)                                                                                    // 393
      return oa < ob ? -1 : 1;                                                                        // 394
    if (ta !== tb)                                                                                    // 395
      // XXX need to implement this if we implement Symbol or integers, or                            // 396
      // Timestamp                                                                                    // 397
      throw Error("Missing type coercion logic in _cmp");                                             // 398
    if (ta === 7) { // ObjectID                                                                       // 399
      // Convert to string.                                                                           // 400
      ta = tb = 2;                                                                                    // 401
      a = a.toHexString();                                                                            // 402
      b = b.toHexString();                                                                            // 403
    }                                                                                                 // 404
    if (ta === 9) { // Date                                                                           // 405
      // Convert to millis.                                                                           // 406
      ta = tb = 1;                                                                                    // 407
      a = a.getTime();                                                                                // 408
      b = b.getTime();                                                                                // 409
    }                                                                                                 // 410
                                                                                                      // 411
    if (ta === 1) // double                                                                           // 412
      return a - b;                                                                                   // 413
    if (tb === 2) // string                                                                           // 414
      return a < b ? -1 : (a === b ? 0 : 1);                                                          // 415
    if (ta === 3) { // Object                                                                         // 416
      // this could be much more efficient in the expected case ...                                   // 417
      var to_array = function (obj) {                                                                 // 418
        var ret = [];                                                                                 // 419
        for (var key in obj) {                                                                        // 420
          ret.push(key);                                                                              // 421
          ret.push(obj[key]);                                                                         // 422
        }                                                                                             // 423
        return ret;                                                                                   // 424
      };                                                                                              // 425
      return LocalCollection._f._cmp(to_array(a), to_array(b));                                       // 426
    }                                                                                                 // 427
    if (ta === 4) { // Array                                                                          // 428
      for (var i = 0; ; i++) {                                                                        // 429
        if (i === a.length)                                                                           // 430
          return (i === b.length) ? 0 : -1;                                                           // 431
        if (i === b.length)                                                                           // 432
          return 1;                                                                                   // 433
        var s = LocalCollection._f._cmp(a[i], b[i]);                                                  // 434
        if (s !== 0)                                                                                  // 435
          return s;                                                                                   // 436
      }                                                                                               // 437
    }                                                                                                 // 438
    if (ta === 5) { // binary                                                                         // 439
      // Surprisingly, a small binary blob is always less than a large one in                         // 440
      // Mongo.                                                                                       // 441
      if (a.length !== b.length)                                                                      // 442
        return a.length - b.length;                                                                   // 443
      for (i = 0; i < a.length; i++) {                                                                // 444
        if (a[i] < b[i])                                                                              // 445
          return -1;                                                                                  // 446
        if (a[i] > b[i])                                                                              // 447
          return 1;                                                                                   // 448
      }                                                                                               // 449
      return 0;                                                                                       // 450
    }                                                                                                 // 451
    if (ta === 8) { // boolean                                                                        // 452
      if (a) return b ? 0 : 1;                                                                        // 453
      return b ? -1 : 0;                                                                              // 454
    }                                                                                                 // 455
    if (ta === 10) // null                                                                            // 456
      return 0;                                                                                       // 457
    if (ta === 11) // regexp                                                                          // 458
      throw Error("Sorting not supported on regular expression"); // XXX                              // 459
    // 13: javascript code                                                                            // 460
    // 14: symbol                                                                                     // 461
    // 15: javascript code with scope                                                                 // 462
    // 16: 32-bit integer                                                                             // 463
    // 17: timestamp                                                                                  // 464
    // 18: 64-bit integer                                                                             // 465
    // 255: minkey                                                                                    // 466
    // 127: maxkey                                                                                    // 467
    if (ta === 13) // javascript code                                                                 // 468
      throw Error("Sorting not supported on Javascript code"); // XXX                                 // 469
    throw Error("Unknown type to sort");                                                              // 470
  }                                                                                                   // 471
};                                                                                                    // 472
                                                                                                      // 473
// For unit tests. True if the given document matches the given                                       // 474
// selector.                                                                                          // 475
LocalCollection._matches = function (selector, doc) {                                                 // 476
  return (LocalCollection._compileSelector(selector))(doc);                                           // 477
};                                                                                                    // 478
                                                                                                      // 479
// _makeLookupFunction(key) returns a lookup function.                                                // 480
//                                                                                                    // 481
// A lookup function takes in a document and returns an array of matching                             // 482
// values.  This array has more than one element if any segment of the key other                      // 483
// than the last one is an array.  ie, any arrays found when doing non-final                          // 484
// lookups result in this function "branching"; each element in the returned                          // 485
// array represents the value found at this branch. If any branch doesn't have a                      // 486
// final value for the full key, its element in the returned list will be                             // 487
// undefined. It always returns a non-empty array.                                                    // 488
//                                                                                                    // 489
// _makeLookupFunction('a.x')({a: {x: 1}}) returns [1]                                                // 490
// _makeLookupFunction('a.x')({a: {x: [1]}}) returns [[1]]                                            // 491
// _makeLookupFunction('a.x')({a: 5})  returns [undefined]                                            // 492
// _makeLookupFunction('a.x')({a: [{x: 1},                                                            // 493
//                                 {x: [2]},                                                          // 494
//                                 {y: 3}]})                                                          // 495
//   returns [1, [2], undefined]                                                                      // 496
LocalCollection._makeLookupFunction = function (key) {                                                // 497
  var dotLocation = key.indexOf('.');                                                                 // 498
  var first, lookupRest, nextIsNumeric;                                                               // 499
  if (dotLocation === -1) {                                                                           // 500
    first = key;                                                                                      // 501
  } else {                                                                                            // 502
    first = key.substr(0, dotLocation);                                                               // 503
    var rest = key.substr(dotLocation + 1);                                                           // 504
    lookupRest = LocalCollection._makeLookupFunction(rest);                                           // 505
    // Is the next (perhaps final) piece numeric (ie, an array lookup?)                               // 506
    nextIsNumeric = /^\d+(\.|$)/.test(rest);                                                          // 507
  }                                                                                                   // 508
                                                                                                      // 509
  return function (doc) {                                                                             // 510
    if (doc == null)  // null or undefined                                                            // 511
      return [undefined];                                                                             // 512
    var firstLevel = doc[first];                                                                      // 513
                                                                                                      // 514
    // We don't "branch" at the final level.                                                          // 515
    if (!lookupRest)                                                                                  // 516
      return [firstLevel];                                                                            // 517
                                                                                                      // 518
    // It's an empty array, and we're not done: we won't find anything.                               // 519
    if (isArray(firstLevel) && firstLevel.length === 0)                                               // 520
      return [undefined];                                                                             // 521
                                                                                                      // 522
    // For each result at this level, finish the lookup on the rest of the key,                       // 523
    // and return everything we find. Also, if the next result is a number,                           // 524
    // don't branch here.                                                                             // 525
    //                                                                                                // 526
    // Technically, in MongoDB, we should be able to handle the case where                            // 527
    // objects have numeric keys, but Mongo doesn't actually handle this                              // 528
    // consistently yet itself, see eg                                                                // 529
    // https://jira.mongodb.org/browse/SERVER-2898                                                    // 530
    // https://github.com/mongodb/mongo/blob/master/jstests/array_match2.js                           // 531
    if (!isArray(firstLevel) || nextIsNumeric)                                                        // 532
      firstLevel = [firstLevel];                                                                      // 533
    return Array.prototype.concat.apply([], _.map(firstLevel, lookupRest));                           // 534
  };                                                                                                  // 535
};                                                                                                    // 536
                                                                                                      // 537
// The main compilation function for a given selector.                                                // 538
var compileDocumentSelector = function (docSelector) {                                                // 539
  var perKeySelectors = [];                                                                           // 540
  _.each(docSelector, function (subSelector, key) {                                                   // 541
    if (key.substr(0, 1) === '$') {                                                                   // 542
      // Outer operators are either logical operators (they recurse back into                         // 543
      // this function), or $where.                                                                   // 544
      if (!_.has(LOGICAL_OPERATORS, key))                                                             // 545
        throw new Error("Unrecognized logical operator: " + key);                                     // 546
      perKeySelectors.push(LOGICAL_OPERATORS[key](subSelector));                                      // 547
    } else {                                                                                          // 548
      var lookUpByIndex = LocalCollection._makeLookupFunction(key);                                   // 549
      var valueSelectorFunc = compileValueSelector(subSelector);                                      // 550
      perKeySelectors.push(function (doc) {                                                           // 551
        var branchValues = lookUpByIndex(doc);                                                        // 552
        // We apply the selector to each "branched" value and return true if any                      // 553
        // match. This isn't 100% consistent with MongoDB; eg, see:                                   // 554
        // https://jira.mongodb.org/browse/SERVER-8585                                                // 555
        return _.any(branchValues, valueSelectorFunc);                                                // 556
      });                                                                                             // 557
    }                                                                                                 // 558
  });                                                                                                 // 559
                                                                                                      // 560
                                                                                                      // 561
  return function (doc) {                                                                             // 562
    return _.all(perKeySelectors, function (f) {                                                      // 563
      return f(doc);                                                                                  // 564
    });                                                                                               // 565
  };                                                                                                  // 566
};                                                                                                    // 567
                                                                                                      // 568
// Given a selector, return a function that takes one argument, a                                     // 569
// document, and returns true if the document matches the selector,                                   // 570
// else false.                                                                                        // 571
LocalCollection._compileSelector = function (selector) {                                              // 572
  // you can pass a literal function instead of a selector                                            // 573
  if (selector instanceof Function)                                                                   // 574
    return function (doc) {return selector.call(doc);};                                               // 575
                                                                                                      // 576
  // shorthand -- scalars match _id                                                                   // 577
  if (LocalCollection._selectorIsId(selector)) {                                                      // 578
    return function (doc) {                                                                           // 579
      return EJSON.equals(doc._id, selector);                                                         // 580
    };                                                                                                // 581
  }                                                                                                   // 582
                                                                                                      // 583
  // protect against dangerous selectors.  falsey and {_id: falsey} are both                          // 584
  // likely programmer error, and not what you want, particularly for                                 // 585
  // destructive operations.                                                                          // 586
  if (!selector || (('_id' in selector) && !selector._id))                                            // 587
    return function (doc) {return false;};                                                            // 588
                                                                                                      // 589
  // Top level can't be an array or true or binary.                                                   // 590
  if (typeof(selector) === 'boolean' || isArray(selector) ||                                          // 591
      EJSON.isBinary(selector))                                                                       // 592
    throw new Error("Invalid selector: " + selector);                                                 // 593
                                                                                                      // 594
  return compileDocumentSelector(selector);                                                           // 595
};                                                                                                    // 596
                                                                                                      // 597
// Give a sort spec, which can be in any of these forms:                                              // 598
//   {"key1": 1, "key2": -1}                                                                          // 599
//   [["key1", "asc"], ["key2", "desc"]]                                                              // 600
//   ["key1", ["key2", "desc"]]                                                                       // 601
//                                                                                                    // 602
// (.. with the first form being dependent on the key enumeration                                     // 603
// behavior of your javascript VM, which usually does what you mean in                                // 604
// this case if the key names don't look like integers ..)                                            // 605
//                                                                                                    // 606
// return a function that takes two objects, and returns -1 if the                                    // 607
// first object comes first in order, 1 if the second object comes                                    // 608
// first, or 0 if neither object comes before the other.                                              // 609
                                                                                                      // 610
LocalCollection._compileSort = function (spec) {                                                      // 611
  var sortSpecParts = [];                                                                             // 612
                                                                                                      // 613
  if (spec instanceof Array) {                                                                        // 614
    for (var i = 0; i < spec.length; i++) {                                                           // 615
      if (typeof spec[i] === "string") {                                                              // 616
        sortSpecParts.push({                                                                          // 617
          lookup: LocalCollection._makeLookupFunction(spec[i]),                                       // 618
          ascending: true                                                                             // 619
        });                                                                                           // 620
      } else {                                                                                        // 621
        sortSpecParts.push({                                                                          // 622
          lookup: LocalCollection._makeLookupFunction(spec[i][0]),                                    // 623
          ascending: spec[i][1] !== "desc"                                                            // 624
        });                                                                                           // 625
      }                                                                                               // 626
    }                                                                                                 // 627
  } else if (typeof spec === "object") {                                                              // 628
    for (var key in spec) {                                                                           // 629
      sortSpecParts.push({                                                                            // 630
        lookup: LocalCollection._makeLookupFunction(key),                                             // 631
        ascending: spec[key] >= 0                                                                     // 632
      });                                                                                             // 633
    }                                                                                                 // 634
  } else {                                                                                            // 635
    throw Error("Bad sort specification: ", JSON.stringify(spec));                                    // 636
  }                                                                                                   // 637
                                                                                                      // 638
  if (sortSpecParts.length === 0)                                                                     // 639
    return function () {return 0;};                                                                   // 640
                                                                                                      // 641
  // reduceValue takes in all the possible values for the sort key along various                      // 642
  // branches, and returns the min or max value (according to the bool                                // 643
  // findMin). Each value can itself be an array, and we look at its values                           // 644
  // too. (ie, we do a single level of flattening on branchValues, then find the                      // 645
  // min/max.)                                                                                        // 646
  var reduceValue = function (branchValues, findMin) {                                                // 647
    var reduced;                                                                                      // 648
    var first = true;                                                                                 // 649
    // Iterate over all the values found in all the branches, and if a value is                       // 650
    // an array itself, iterate over the values in the array separately.                              // 651
    _.each(branchValues, function (branchValue) {                                                     // 652
      // Value not an array? Pretend it is.                                                           // 653
      if (!isArray(branchValue))                                                                      // 654
        branchValue = [branchValue];                                                                  // 655
      // Value is an empty array? Pretend it was missing, since that's where it                       // 656
      // should be sorted.                                                                            // 657
      if (isArray(branchValue) && branchValue.length === 0)                                           // 658
        branchValue = [undefined];                                                                    // 659
      _.each(branchValue, function (value) {                                                          // 660
        // We should get here at least once: lookup functions return non-empty                        // 661
        // arrays, so the outer loop runs at least once, and we prevented                             // 662
        // branchValue from being an empty array.                                                     // 663
        if (first) {                                                                                  // 664
          reduced = value;                                                                            // 665
          first = false;                                                                              // 666
        } else {                                                                                      // 667
          // Compare the value we found to the value we found so far, saving it                       // 668
          // if it's less (for an ascending sort) or more (for a descending                           // 669
          // sort).                                                                                   // 670
          var cmp = LocalCollection._f._cmp(reduced, value);                                          // 671
          if ((findMin && cmp > 0) || (!findMin && cmp < 0))                                          // 672
            reduced = value;                                                                          // 673
        }                                                                                             // 674
      });                                                                                             // 675
    });                                                                                               // 676
    return reduced;                                                                                   // 677
  };                                                                                                  // 678
                                                                                                      // 679
  return function (a, b) {                                                                            // 680
    for (var i = 0; i < sortSpecParts.length; ++i) {                                                  // 681
      var specPart = sortSpecParts[i];                                                                // 682
      var aValue = reduceValue(specPart.lookup(a), specPart.ascending);                               // 683
      var bValue = reduceValue(specPart.lookup(b), specPart.ascending);                               // 684
      var compare = LocalCollection._f._cmp(aValue, bValue);                                          // 685
      if (compare !== 0)                                                                              // 686
        return specPart.ascending ? compare : -compare;                                               // 687
    };                                                                                                // 688
    return 0;                                                                                         // 689
  };                                                                                                  // 690
};                                                                                                    // 691
                                                                                                      // 692
////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                    //
// packages/minimongo/modify.js                                                                       //
//                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                      //
// XXX need a strategy for passing the binding of $ into this                                         // 1
// function, from the compiled selector                                                               // 2
//                                                                                                    // 3
// maybe just {key.up.to.just.before.dollarsign: array_index}                                         // 4
//                                                                                                    // 5
// XXX atomicity: if one modification fails, do we roll back the whole                                // 6
// change?                                                                                            // 7
LocalCollection._modify = function (doc, mod) {                                                       // 8
  var is_modifier = false;                                                                            // 9
  for (var k in mod) {                                                                                // 10
    // IE7 doesn't support indexing into strings (eg, k[0]), so use substr.                           // 11
    // Too bad -- it's far slower:                                                                    // 12
    // http://jsperf.com/testing-the-first-character-of-a-string                                      // 13
    is_modifier = k.substr(0, 1) === '$';                                                             // 14
    break; // just check the first key.                                                               // 15
  }                                                                                                   // 16
                                                                                                      // 17
  var new_doc;                                                                                        // 18
                                                                                                      // 19
  if (!is_modifier) {                                                                                 // 20
    if (mod._id && !EJSON.equals(doc._id, mod._id))                                                   // 21
      throw Error("Cannot change the _id of a document");                                             // 22
                                                                                                      // 23
    // replace the whole document                                                                     // 24
    for (var k in mod) {                                                                              // 25
      if (k.substr(0, 1) === '$')                                                                     // 26
        throw Error("When replacing document, field name may not start with '$'");                    // 27
      if (/\./.test(k))                                                                               // 28
        throw Error("When replacing document, field name may not contain '.'");                       // 29
    }                                                                                                 // 30
    new_doc = mod;                                                                                    // 31
  } else {                                                                                            // 32
    // apply modifiers                                                                                // 33
    var new_doc = EJSON.clone(doc);                                                                   // 34
                                                                                                      // 35
    for (var op in mod) {                                                                             // 36
      var mod_func = LocalCollection._modifiers[op];                                                  // 37
      if (!mod_func)                                                                                  // 38
        throw Error("Invalid modifier specified " + op);                                              // 39
      for (var keypath in mod[op]) {                                                                  // 40
        // XXX mongo doesn't allow mod field names to end in a period,                                // 41
        // but I don't see why.. it allows '' as a key, as does JS                                    // 42
        if (keypath.length && keypath[keypath.length-1] === '.')                                      // 43
          throw Error("Invalid mod field name, may not end in a period");                             // 44
                                                                                                      // 45
        var arg = mod[op][keypath];                                                                   // 46
        var keyparts = keypath.split('.');                                                            // 47
        var no_create = !!LocalCollection._noCreateModifiers[op];                                     // 48
        var forbid_array = (op === "$rename");                                                        // 49
        var target = LocalCollection._findModTarget(new_doc, keyparts,                                // 50
                                                    no_create, forbid_array);                         // 51
        var field = keyparts.pop();                                                                   // 52
        mod_func(target, field, arg, keypath, new_doc);                                               // 53
      }                                                                                               // 54
    }                                                                                                 // 55
  }                                                                                                   // 56
                                                                                                      // 57
  // move new document into place.                                                                    // 58
  _.each(_.keys(doc), function (k) {                                                                  // 59
    // Note: this used to be for (var k in doc) however, this does not                                // 60
    // work right in Opera. Deleting from a doc while iterating over it                               // 61
    // would sometimes cause opera to skip some keys.                                                 // 62
    if (k !== '_id')                                                                                  // 63
      delete doc[k];                                                                                  // 64
  });                                                                                                 // 65
  for (var k in new_doc) {                                                                            // 66
    doc[k] = new_doc[k];                                                                              // 67
  }                                                                                                   // 68
};                                                                                                    // 69
                                                                                                      // 70
// for a.b.c.2.d.e, keyparts should be ['a', 'b', 'c', '2', 'd', 'e'],                                // 71
// and then you would operate on the 'e' property of the returned                                     // 72
// object. if no_create is falsey, creates intermediate levels of                                     // 73
// structure as necessary, like mkdir -p (and raises an exception if                                  // 74
// that would mean giving a non-numeric property to an array.) if                                     // 75
// no_create is true, return undefined instead. may modify the last                                   // 76
// element of keyparts to signal to the caller that it needs to use a                                 // 77
// different value to index into the returned object (for example,                                    // 78
// ['a', '01'] -> ['a', 1]). if forbid_array is true, return null if                                  // 79
// the keypath goes through an array.                                                                 // 80
LocalCollection._findModTarget = function (doc, keyparts, no_create,                                  // 81
                                      forbid_array) {                                                 // 82
  for (var i = 0; i < keyparts.length; i++) {                                                         // 83
    var last = (i === keyparts.length - 1);                                                           // 84
    var keypart = keyparts[i];                                                                        // 85
    var numeric = /^[0-9]+$/.test(keypart);                                                           // 86
    if (no_create && (!(typeof doc === "object") || !(keypart in doc)))                               // 87
      return undefined;                                                                               // 88
    if (doc instanceof Array) {                                                                       // 89
      if (forbid_array)                                                                               // 90
        return null;                                                                                  // 91
      if (!numeric)                                                                                   // 92
        throw Error("can't append to array using string field name ["                                 // 93
                    + keypart + "]");                                                                 // 94
      keypart = parseInt(keypart);                                                                    // 95
      if (last)                                                                                       // 96
        // handle 'a.01'                                                                              // 97
        keyparts[i] = keypart;                                                                        // 98
      while (doc.length < keypart)                                                                    // 99
        doc.push(null);                                                                               // 100
      if (!last) {                                                                                    // 101
        if (doc.length === keypart)                                                                   // 102
          doc.push({});                                                                               // 103
        else if (typeof doc[keypart] !== "object")                                                    // 104
          throw Error("can't modify field '" + keyparts[i + 1] +                                      // 105
                      "' of list value " + JSON.stringify(doc[keypart]));                             // 106
      }                                                                                               // 107
    } else {                                                                                          // 108
      // XXX check valid fieldname (no $ at start, no .)                                              // 109
      if (!last && !(keypart in doc))                                                                 // 110
        doc[keypart] = {};                                                                            // 111
    }                                                                                                 // 112
                                                                                                      // 113
    if (last)                                                                                         // 114
      return doc;                                                                                     // 115
    doc = doc[keypart];                                                                               // 116
  }                                                                                                   // 117
                                                                                                      // 118
  // notreached                                                                                       // 119
};                                                                                                    // 120
                                                                                                      // 121
LocalCollection._noCreateModifiers = {                                                                // 122
  $unset: true,                                                                                       // 123
  $pop: true,                                                                                         // 124
  $rename: true,                                                                                      // 125
  $pull: true,                                                                                        // 126
  $pullAll: true                                                                                      // 127
};                                                                                                    // 128
                                                                                                      // 129
LocalCollection._modifiers = {                                                                        // 130
  $inc: function (target, field, arg) {                                                               // 131
    if (typeof arg !== "number")                                                                      // 132
      throw Error("Modifier $inc allowed for numbers only");                                          // 133
    if (field in target) {                                                                            // 134
      if (typeof target[field] !== "number")                                                          // 135
        throw Error("Cannot apply $inc modifier to non-number");                                      // 136
      target[field] += arg;                                                                           // 137
    } else {                                                                                          // 138
      target[field] = arg;                                                                            // 139
    }                                                                                                 // 140
  },                                                                                                  // 141
  $set: function (target, field, arg) {                                                               // 142
    if (field === '_id' && !EJSON.equals(arg, target._id))                                            // 143
      throw Error("Cannot change the _id of a document");                                             // 144
                                                                                                      // 145
    target[field] = EJSON.clone(arg);                                                                 // 146
  },                                                                                                  // 147
  $unset: function (target, field, arg) {                                                             // 148
    if (target !== undefined) {                                                                       // 149
      if (target instanceof Array) {                                                                  // 150
        if (field in target)                                                                          // 151
          target[field] = null;                                                                       // 152
      } else                                                                                          // 153
        delete target[field];                                                                         // 154
    }                                                                                                 // 155
  },                                                                                                  // 156
  $push: function (target, field, arg) {                                                              // 157
    var x = target[field];                                                                            // 158
    if (x === undefined)                                                                              // 159
      target[field] = [arg];                                                                          // 160
    else if (!(x instanceof Array))                                                                   // 161
      throw Error("Cannot apply $push modifier to non-array");                                        // 162
    else                                                                                              // 163
      x.push(EJSON.clone(arg));                                                                       // 164
  },                                                                                                  // 165
  $pushAll: function (target, field, arg) {                                                           // 166
    if (!(typeof arg === "object" && arg instanceof Array))                                           // 167
      throw Error("Modifier $pushAll/pullAll allowed for arrays only");                               // 168
    var x = target[field];                                                                            // 169
    if (x === undefined)                                                                              // 170
      target[field] = arg;                                                                            // 171
    else if (!(x instanceof Array))                                                                   // 172
      throw Error("Cannot apply $pushAll modifier to non-array");                                     // 173
    else {                                                                                            // 174
      for (var i = 0; i < arg.length; i++)                                                            // 175
        x.push(arg[i]);                                                                               // 176
    }                                                                                                 // 177
  },                                                                                                  // 178
  $addToSet: function (target, field, arg) {                                                          // 179
    var x = target[field];                                                                            // 180
    if (x === undefined)                                                                              // 181
      target[field] = [arg];                                                                          // 182
    else if (!(x instanceof Array))                                                                   // 183
      throw Error("Cannot apply $addToSet modifier to non-array");                                    // 184
    else {                                                                                            // 185
      var isEach = false;                                                                             // 186
      if (typeof arg === "object") {                                                                  // 187
        for (var k in arg) {                                                                          // 188
          if (k === "$each")                                                                          // 189
            isEach = true;                                                                            // 190
          break;                                                                                      // 191
        }                                                                                             // 192
      }                                                                                               // 193
      var values = isEach ? arg["$each"] : [arg];                                                     // 194
      _.each(values, function (value) {                                                               // 195
        for (var i = 0; i < x.length; i++)                                                            // 196
          if (LocalCollection._f._equal(value, x[i]))                                                 // 197
            return;                                                                                   // 198
        x.push(value);                                                                                // 199
      });                                                                                             // 200
    }                                                                                                 // 201
  },                                                                                                  // 202
  $pop: function (target, field, arg) {                                                               // 203
    if (target === undefined)                                                                         // 204
      return;                                                                                         // 205
    var x = target[field];                                                                            // 206
    if (x === undefined)                                                                              // 207
      return;                                                                                         // 208
    else if (!(x instanceof Array))                                                                   // 209
      throw Error("Cannot apply $pop modifier to non-array");                                         // 210
    else {                                                                                            // 211
      if (typeof arg === 'number' && arg < 0)                                                         // 212
        x.splice(0, 1);                                                                               // 213
      else                                                                                            // 214
        x.pop();                                                                                      // 215
    }                                                                                                 // 216
  },                                                                                                  // 217
  $pull: function (target, field, arg) {                                                              // 218
    if (target === undefined)                                                                         // 219
      return;                                                                                         // 220
    var x = target[field];                                                                            // 221
    if (x === undefined)                                                                              // 222
      return;                                                                                         // 223
    else if (!(x instanceof Array))                                                                   // 224
      throw Error("Cannot apply $pull/pullAll modifier to non-array");                                // 225
    else {                                                                                            // 226
      var out = []                                                                                    // 227
      if (typeof arg === "object" && !(arg instanceof Array)) {                                       // 228
        // XXX would be much nicer to compile this once, rather than                                  // 229
        // for each document we modify.. but usually we're not                                        // 230
        // modifying that many documents, so we'll let it slide for                                   // 231
        // now                                                                                        // 232
                                                                                                      // 233
        // XXX _compileSelector isn't up for the job, because we need                                 // 234
        // to permit stuff like {$pull: {a: {$gt: 4}}}.. something                                    // 235
        // like {$gt: 4} is not normally a complete selector.                                         // 236
        // same issue as $elemMatch possibly?                                                         // 237
        var match = LocalCollection._compileSelector(arg);                                            // 238
        for (var i = 0; i < x.length; i++)                                                            // 239
          if (!match(x[i]))                                                                           // 240
            out.push(x[i])                                                                            // 241
      } else {                                                                                        // 242
        for (var i = 0; i < x.length; i++)                                                            // 243
          if (!LocalCollection._f._equal(x[i], arg))                                                  // 244
            out.push(x[i]);                                                                           // 245
      }                                                                                               // 246
      target[field] = out;                                                                            // 247
    }                                                                                                 // 248
  },                                                                                                  // 249
  $pullAll: function (target, field, arg) {                                                           // 250
    if (!(typeof arg === "object" && arg instanceof Array))                                           // 251
      throw Error("Modifier $pushAll/pullAll allowed for arrays only");                               // 252
    if (target === undefined)                                                                         // 253
      return;                                                                                         // 254
    var x = target[field];                                                                            // 255
    if (x === undefined)                                                                              // 256
      return;                                                                                         // 257
    else if (!(x instanceof Array))                                                                   // 258
      throw Error("Cannot apply $pull/pullAll modifier to non-array");                                // 259
    else {                                                                                            // 260
      var out = []                                                                                    // 261
      for (var i = 0; i < x.length; i++) {                                                            // 262
        var exclude = false;                                                                          // 263
        for (var j = 0; j < arg.length; j++) {                                                        // 264
          if (LocalCollection._f._equal(x[i], arg[j])) {                                              // 265
            exclude = true;                                                                           // 266
            break;                                                                                    // 267
          }                                                                                           // 268
        }                                                                                             // 269
        if (!exclude)                                                                                 // 270
          out.push(x[i]);                                                                             // 271
      }                                                                                               // 272
      target[field] = out;                                                                            // 273
    }                                                                                                 // 274
  },                                                                                                  // 275
  $rename: function (target, field, arg, keypath, doc) {                                              // 276
    if (keypath === arg)                                                                              // 277
      // no idea why mongo has this restriction..                                                     // 278
      throw Error("$rename source must differ from target");                                          // 279
    if (target === null)                                                                              // 280
      throw Error("$rename source field invalid");                                                    // 281
    if (typeof arg !== "string")                                                                      // 282
      throw Error("$rename target must be a string");                                                 // 283
    if (target === undefined)                                                                         // 284
      return;                                                                                         // 285
    var v = target[field];                                                                            // 286
    delete target[field];                                                                             // 287
                                                                                                      // 288
    var keyparts = arg.split('.');                                                                    // 289
    var target2 = LocalCollection._findModTarget(doc, keyparts, false, true);                         // 290
    if (target2 === null)                                                                             // 291
      throw Error("$rename target field invalid");                                                    // 292
    var field2 = keyparts.pop();                                                                      // 293
    target2[field2] = v;                                                                              // 294
  },                                                                                                  // 295
  $bit: function (target, field, arg) {                                                               // 296
    // XXX mongo only supports $bit on integers, and we only support                                  // 297
    // native javascript numbers (doubles) so far, so we can't support $bit                           // 298
    throw Error("$bit is not supported");                                                             // 299
  }                                                                                                   // 300
};                                                                                                    // 301
                                                                                                      // 302
////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                    //
// packages/minimongo/diff.js                                                                         //
//                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                      //
                                                                                                      // 1
// ordered: bool.                                                                                     // 2
// old_results and new_results: collections of documents.                                             // 3
//    if ordered, they are arrays.                                                                    // 4
//    if unordered, they are maps {_id: doc}.                                                         // 5
// observer: object with 'added', 'changed', 'removed',                                               // 6
//           and (if ordered) 'moved' functions (each optional)                                       // 7
LocalCollection._diffQueryChanges = function (ordered, oldResults, newResults,                        // 8
                                       observer) {                                                    // 9
  if (ordered)                                                                                        // 10
    LocalCollection._diffQueryOrderedChanges(                                                         // 11
      oldResults, newResults, observer);                                                              // 12
  else                                                                                                // 13
    LocalCollection._diffQueryUnorderedChanges(                                                       // 14
      oldResults, newResults, observer);                                                              // 15
};                                                                                                    // 16
                                                                                                      // 17
LocalCollection._diffQueryUnorderedChanges = function (oldResults, newResults,                        // 18
                                                observer) {                                           // 19
  if (observer.moved) {                                                                               // 20
    throw new Error("_diffQueryUnordered called with a moved observer!");                             // 21
  }                                                                                                   // 22
                                                                                                      // 23
  _.each(newResults, function (newDoc) {                                                              // 24
    if (_.has(oldResults, newDoc._id)) {                                                              // 25
      var oldDoc = oldResults[newDoc._id];                                                            // 26
      if (observer.changed && !EJSON.equals(oldDoc, newDoc)) {                                        // 27
        observer.changed(newDoc._id, LocalCollection._makeChangedFields(newDoc, oldDoc));             // 28
      }                                                                                               // 29
    } else {                                                                                          // 30
      var fields = EJSON.clone(newDoc);                                                               // 31
      delete fields._id;                                                                              // 32
      observer.added && observer.added(newDoc._id, fields);                                           // 33
    }                                                                                                 // 34
  });                                                                                                 // 35
                                                                                                      // 36
  if (observer.removed) {                                                                             // 37
    _.each(oldResults, function (oldDoc) {                                                            // 38
      if (!_.has(newResults, oldDoc._id))                                                             // 39
        observer.removed(oldDoc._id);                                                                 // 40
    });                                                                                               // 41
  }                                                                                                   // 42
};                                                                                                    // 43
                                                                                                      // 44
                                                                                                      // 45
LocalCollection._diffQueryOrderedChanges = function (old_results, new_results, observer) {            // 46
                                                                                                      // 47
  var new_presence_of_id = {};                                                                        // 48
  _.each(new_results, function (doc) {                                                                // 49
    if (new_presence_of_id[doc._id])                                                                  // 50
      Meteor._debug("Duplicate _id in new_results");                                                  // 51
    new_presence_of_id[doc._id] = true;                                                               // 52
  });                                                                                                 // 53
                                                                                                      // 54
  var old_index_of_id = {};                                                                           // 55
  _.each(old_results, function (doc, i) {                                                             // 56
    if (doc._id in old_index_of_id)                                                                   // 57
      Meteor._debug("Duplicate _id in old_results");                                                  // 58
    old_index_of_id[doc._id] = i;                                                                     // 59
  });                                                                                                 // 60
                                                                                                      // 61
  // ALGORITHM:                                                                                       // 62
  //                                                                                                  // 63
  // To determine which docs should be considered "moved" (and which                                  // 64
  // merely change position because of other docs moving) we run                                      // 65
  // a "longest common subsequence" (LCS) algorithm.  The LCS of the                                  // 66
  // old doc IDs and the new doc IDs gives the docs that should NOT be                                // 67
  // considered moved.                                                                                // 68
                                                                                                      // 69
  // To actually call the appropriate callbacks to get from the old state to the                      // 70
  // new state:                                                                                       // 71
                                                                                                      // 72
  // First, we call removed() on all the items that only appear in the old                            // 73
  // state.                                                                                           // 74
                                                                                                      // 75
  // Then, once we have the items that should not move, we walk through the new                       // 76
  // results array group-by-group, where a "group" is a set of items that have                        // 77
  // moved, anchored on the end by an item that should not move.  One by one, we                      // 78
  // move each of those elements into place "before" the anchoring end-of-group                       // 79
  // item, and fire changed events on them if necessary.  Then we fire a changed                      // 80
  // event on the anchor, and move on to the next group.  There is always at                          // 81
  // least one group; the last group is anchored by a virtual "null" id at the                        // 82
  // end.                                                                                             // 83
                                                                                                      // 84
  // Asymptotically: O(N k) where k is number of ops, or potentially                                  // 85
  // O(N log N) if inner loop of LCS were made to be binary search.                                   // 86
                                                                                                      // 87
                                                                                                      // 88
  //////// LCS (longest common sequence, with respect to _id)                                         // 89
  // (see Wikipedia article on Longest Increasing Subsequence,                                        // 90
  // where the LIS is taken of the sequence of old indices of the                                     // 91
  // docs in new_results)                                                                             // 92
  //                                                                                                  // 93
  // unmoved: the output of the algorithm; members of the LCS,                                        // 94
  // in the form of indices into new_results                                                          // 95
  var unmoved = [];                                                                                   // 96
  // max_seq_len: length of LCS found so far                                                          // 97
  var max_seq_len = 0;                                                                                // 98
  // seq_ends[i]: the index into new_results of the last doc in a                                     // 99
  // common subsequence of length of i+1 <= max_seq_len                                               // 100
  var N = new_results.length;                                                                         // 101
  var seq_ends = new Array(N);                                                                        // 102
  // ptrs:  the common subsequence ending with new_results[n] extends                                 // 103
  // a common subsequence ending with new_results[ptr[n]], unless                                     // 104
  // ptr[n] is -1.                                                                                    // 105
  var ptrs = new Array(N);                                                                            // 106
  // virtual sequence of old indices of new results                                                   // 107
  var old_idx_seq = function(i_new) {                                                                 // 108
    return old_index_of_id[new_results[i_new]._id];                                                   // 109
  };                                                                                                  // 110
  // for each item in new_results, use it to extend a common subsequence                              // 111
  // of length j <= max_seq_len                                                                       // 112
  for(var i=0; i<N; i++) {                                                                            // 113
    if (old_index_of_id[new_results[i]._id] !== undefined) {                                          // 114
      var j = max_seq_len;                                                                            // 115
      // this inner loop would traditionally be a binary search,                                      // 116
      // but scanning backwards we will likely find a subseq to extend                                // 117
      // pretty soon, bounded for example by the total number of ops.                                 // 118
      // If this were to be changed to a binary search, we'd still want                               // 119
      // to scan backwards a bit as an optimization.                                                  // 120
      while (j > 0) {                                                                                 // 121
        if (old_idx_seq(seq_ends[j-1]) < old_idx_seq(i))                                              // 122
          break;                                                                                      // 123
        j--;                                                                                          // 124
      }                                                                                               // 125
                                                                                                      // 126
      ptrs[i] = (j === 0 ? -1 : seq_ends[j-1]);                                                       // 127
      seq_ends[j] = i;                                                                                // 128
      if (j+1 > max_seq_len)                                                                          // 129
        max_seq_len = j+1;                                                                            // 130
    }                                                                                                 // 131
  }                                                                                                   // 132
                                                                                                      // 133
  // pull out the LCS/LIS into unmoved                                                                // 134
  var idx = (max_seq_len === 0 ? -1 : seq_ends[max_seq_len-1]);                                       // 135
  while (idx >= 0) {                                                                                  // 136
    unmoved.push(idx);                                                                                // 137
    idx = ptrs[idx];                                                                                  // 138
  }                                                                                                   // 139
  // the unmoved item list is built backwards, so fix that                                            // 140
  unmoved.reverse();                                                                                  // 141
                                                                                                      // 142
  // the last group is always anchored by the end of the result list, which is                        // 143
  // an id of "null"                                                                                  // 144
  unmoved.push(new_results.length);                                                                   // 145
                                                                                                      // 146
  _.each(old_results, function (doc) {                                                                // 147
    if (!new_presence_of_id[doc._id])                                                                 // 148
      observer.removed && observer.removed(doc._id);                                                  // 149
  });                                                                                                 // 150
  // for each group of things in the new_results that is anchored by an unmoved                       // 151
  // element, iterate through the things before it.                                                   // 152
  var startOfGroup = 0;                                                                               // 153
  _.each(unmoved, function (endOfGroup) {                                                             // 154
    var groupId = new_results[endOfGroup] ? new_results[endOfGroup]._id : null;                       // 155
    var oldDoc;                                                                                       // 156
    var newDoc;                                                                                       // 157
    var fields;                                                                                       // 158
    for (var i = startOfGroup; i < endOfGroup; i++) {                                                 // 159
      newDoc = new_results[i];                                                                        // 160
      if (!_.has(old_index_of_id, newDoc._id)) {                                                      // 161
        fields = EJSON.clone(newDoc);                                                                 // 162
        delete fields._id;                                                                            // 163
        observer.addedBefore && observer.addedBefore(newDoc._id, fields, groupId);                    // 164
        observer.added && observer.added(newDoc._id, fields);                                         // 165
      } else {                                                                                        // 166
        // moved                                                                                      // 167
        oldDoc = old_results[old_index_of_id[newDoc._id]];                                            // 168
        fields = LocalCollection._makeChangedFields(newDoc, oldDoc);                                  // 169
        if (!_.isEmpty(fields)) {                                                                     // 170
          observer.changed && observer.changed(newDoc._id, fields);                                   // 171
        }                                                                                             // 172
        observer.movedBefore && observer.movedBefore(newDoc._id, groupId);                            // 173
      }                                                                                               // 174
    }                                                                                                 // 175
    if (groupId) {                                                                                    // 176
      newDoc = new_results[endOfGroup];                                                               // 177
      oldDoc = old_results[old_index_of_id[newDoc._id]];                                              // 178
      fields = LocalCollection._makeChangedFields(newDoc, oldDoc);                                    // 179
      if (!_.isEmpty(fields)) {                                                                       // 180
        observer.changed && observer.changed(newDoc._id, fields);                                     // 181
      }                                                                                               // 182
    }                                                                                                 // 183
    startOfGroup = endOfGroup+1;                                                                      // 184
  });                                                                                                 // 185
                                                                                                      // 186
                                                                                                      // 187
};                                                                                                    // 188
                                                                                                      // 189
                                                                                                      // 190
// General helper for diff-ing two objects.                                                           // 191
// callbacks is an object like so:                                                                    // 192
// { leftOnly: function (key, leftValue) {...},                                                       // 193
//   rightOnly: function (key, rightValue) {...},                                                     // 194
//   both: function (key, leftValue, rightValue) {...},                                               // 195
// }                                                                                                  // 196
LocalCollection._diffObjects = function (left, right, callbacks) {                                    // 197
  _.each(left, function (leftValue, key) {                                                            // 198
    if (_.has(right, key))                                                                            // 199
      callbacks.both && callbacks.both(key, leftValue, right[key]);                                   // 200
    else                                                                                              // 201
      callbacks.leftOnly && callbacks.leftOnly(key, leftValue);                                       // 202
  });                                                                                                 // 203
  if (callbacks.rightOnly) {                                                                          // 204
    _.each(right, function(rightValue, key) {                                                         // 205
      if (!_.has(left, key))                                                                          // 206
        callbacks.rightOnly(key, rightValue);                                                         // 207
    });                                                                                               // 208
  }                                                                                                   // 209
};                                                                                                    // 210
                                                                                                      // 211
////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                    //
// packages/minimongo/objectid.js                                                                     //
//                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                      //
LocalCollection._looksLikeObjectID = function (str) {                                                 // 1
  return str.length === 24 && str.match(/^[0-9a-f]*$/);                                               // 2
};                                                                                                    // 3
                                                                                                      // 4
LocalCollection._ObjectID = function (hexString) {                                                    // 5
  //random-based impl of Mongo ObjectID                                                               // 6
  var self = this;                                                                                    // 7
  if (hexString) {                                                                                    // 8
    hexString = hexString.toLowerCase();                                                              // 9
    if (!LocalCollection._looksLikeObjectID(hexString)) {                                             // 10
      throw new Error("Invalid hexadecimal string for creating an ObjectID");                         // 11
    }                                                                                                 // 12
    // meant to work with _.isEqual(), which relies on structural equality                            // 13
    self._str = hexString;                                                                            // 14
  } else {                                                                                            // 15
    self._str = Random.hexString(24);                                                                 // 16
  }                                                                                                   // 17
};                                                                                                    // 18
                                                                                                      // 19
LocalCollection._ObjectID.prototype.toString = function () {                                          // 20
  var self = this;                                                                                    // 21
  return "ObjectID(\"" + self._str + "\")";                                                           // 22
};                                                                                                    // 23
                                                                                                      // 24
LocalCollection._ObjectID.prototype.equals = function (other) {                                       // 25
  var self = this;                                                                                    // 26
  return other instanceof LocalCollection._ObjectID &&                                                // 27
    self.valueOf() === other.valueOf();                                                               // 28
};                                                                                                    // 29
                                                                                                      // 30
LocalCollection._ObjectID.prototype.clone = function () {                                             // 31
  var self = this;                                                                                    // 32
  return new LocalCollection._ObjectID(self._str);                                                    // 33
};                                                                                                    // 34
                                                                                                      // 35
LocalCollection._ObjectID.prototype.typeName = function() {                                           // 36
  return "oid";                                                                                       // 37
};                                                                                                    // 38
                                                                                                      // 39
LocalCollection._ObjectID.prototype.getTimestamp = function() {                                       // 40
  var self = this;                                                                                    // 41
  return parseInt(self._str.substr(0, 8), 16);                                                        // 42
};                                                                                                    // 43
                                                                                                      // 44
LocalCollection._ObjectID.prototype.valueOf =                                                         // 45
    LocalCollection._ObjectID.prototype.toJSONValue =                                                 // 46
    LocalCollection._ObjectID.prototype.toHexString =                                                 // 47
    function () { return this._str; };                                                                // 48
                                                                                                      // 49
// Is this selector just shorthand for lookup by _id?                                                 // 50
LocalCollection._selectorIsId = function (selector) {                                                 // 51
  return (typeof selector === "string") ||                                                            // 52
    (typeof selector === "number") ||                                                                 // 53
    selector instanceof LocalCollection._ObjectID;                                                    // 54
};                                                                                                    // 55
                                                                                                      // 56
// Is the selector just lookup by _id (shorthand or not)?                                             // 57
LocalCollection._selectorIsIdPerhapsAsObject = function (selector) {                                  // 58
  return LocalCollection._selectorIsId(selector) ||                                                   // 59
    (selector && typeof selector === "object" &&                                                      // 60
     selector._id && LocalCollection._selectorIsId(selector._id) &&                                   // 61
     _.size(selector) === 1);                                                                         // 62
};                                                                                                    // 63
                                                                                                      // 64
// If this is a selector which explicitly constrains the match by ID to a finite                      // 65
// number of documents, returns a list of their IDs.  Otherwise returns                               // 66
// null. Note that the selector may have other restrictions so it may not even                        // 67
// match those document!  We care about $in and $and since those are generated                        // 68
// access-controlled update and remove.                                                               // 69
LocalCollection._idsMatchedBySelector = function (selector) {                                         // 70
  // Is the selector just an ID?                                                                      // 71
  if (LocalCollection._selectorIsId(selector))                                                        // 72
    return [selector];                                                                                // 73
  if (!selector)                                                                                      // 74
    return null;                                                                                      // 75
                                                                                                      // 76
  // Do we have an _id clause?                                                                        // 77
  if (_.has(selector, '_id')) {                                                                       // 78
    // Is the _id clause just an ID?                                                                  // 79
    if (LocalCollection._selectorIsId(selector._id))                                                  // 80
      return [selector._id];                                                                          // 81
    // Is the _id clause {_id: {$in: ["x", "y", "z"]}}?                                               // 82
    if (selector._id && selector._id.$in                                                              // 83
        && _.isArray(selector._id.$in)                                                                // 84
        && !_.isEmpty(selector._id.$in)                                                               // 85
        && _.all(selector._id.$in, LocalCollection._selectorIsId)) {                                  // 86
      return selector._id.$in;                                                                        // 87
    }                                                                                                 // 88
    return null;                                                                                      // 89
  }                                                                                                   // 90
                                                                                                      // 91
  // If this is a top-level $and, and any of the clauses constrain their                              // 92
  // documents, then the whole selector is constrained by any one clause's                            // 93
  // constraint. (Well, by their intersection, but that seems unlikely.)                              // 94
  if (selector.$and && _.isArray(selector.$and)) {                                                    // 95
    for (var i = 0; i < selector.$and.length; ++i) {                                                  // 96
      var subIds = LocalCollection._idsMatchedBySelector(selector.$and[i]);                           // 97
      if (subIds)                                                                                     // 98
        return subIds;                                                                                // 99
    }                                                                                                 // 100
  }                                                                                                   // 101
                                                                                                      // 102
  return null;                                                                                        // 103
};                                                                                                    // 104
                                                                                                      // 105
EJSON.addType("oid",  function (str) {                                                                // 106
  return new LocalCollection._ObjectID(str);                                                          // 107
});                                                                                                   // 108
                                                                                                      // 109
////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.minimongo = {
  LocalCollection: LocalCollection
};

})();
