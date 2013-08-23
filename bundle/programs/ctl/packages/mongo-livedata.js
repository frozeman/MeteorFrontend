(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var Random = Package.random.Random;
var EJSON = Package.ejson.EJSON;
var _ = Package.underscore._;
var LocalCollection = Package.minimongo.LocalCollection;
var Log = Package.logging.Log;
var DDP = Package.livedata.DDP;
var DDPServer = Package.livedata.DDPServer;
var Deps = Package.deps.Deps;
var check = Package.check.check;
var Match = Package.check.Match;

/* Package-scope variables */
var MongoInternals, MongoConnection, LocalCollectionDriver;

(function () {

///////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                           //
// packages/mongo-livedata/mongo_driver.js                                                   //
//                                                                                           //
///////////////////////////////////////////////////////////////////////////////////////////////
                                                                                             //
/**                                                                                          // 1
 * Provide a synchronous Collection API using fibers, backed by                              // 2
 * MongoDB.  This is only for use on the server, and mostly identical                        // 3
 * to the client API.                                                                        // 4
 *                                                                                           // 5
 * NOTE: the public API methods must be run within a fiber. If you call                      // 6
 * these outside of a fiber they will explode!                                               // 7
 */                                                                                          // 8
                                                                                             // 9
var path = Npm.require('path');                                                              // 10
var MongoDB = Npm.require('mongodb');                                                        // 11
var Fiber = Npm.require('fibers');                                                           // 12
var Future = Npm.require(path.join('fibers', 'future'));                                     // 13
                                                                                             // 14
MongoInternals = {};                                                                         // 15
                                                                                             // 16
var replaceNames = function (filter, thing) {                                                // 17
  if (typeof thing === "object") {                                                           // 18
    if (_.isArray(thing)) {                                                                  // 19
      return _.map(thing, _.bind(replaceNames, null, filter));                               // 20
    }                                                                                        // 21
    var ret = {};                                                                            // 22
    _.each(thing, function (value, key) {                                                    // 23
      ret[filter(key)] = replaceNames(filter, value);                                        // 24
    });                                                                                      // 25
    return ret;                                                                              // 26
  }                                                                                          // 27
  return thing;                                                                              // 28
};                                                                                           // 29
                                                                                             // 30
var makeMongoLegal = function (name) { return "EJSON" + name; };                             // 31
var unmakeMongoLegal = function (name) { return name.substr(5); };                           // 32
                                                                                             // 33
var replaceMongoAtomWithMeteor = function (document) {                                       // 34
  if (document instanceof MongoDB.Binary) {                                                  // 35
    var buffer = document.value(true);                                                       // 36
    return new Uint8Array(buffer);                                                           // 37
  }                                                                                          // 38
  if (document instanceof MongoDB.ObjectID) {                                                // 39
    return new Meteor.Collection.ObjectID(document.toHexString());                           // 40
  }                                                                                          // 41
  if (document["EJSON$type"] && document["EJSON$value"]) {                                   // 42
    return EJSON.fromJSONValue(replaceNames(unmakeMongoLegal, document));                    // 43
  }                                                                                          // 44
  return undefined;                                                                          // 45
};                                                                                           // 46
                                                                                             // 47
var replaceMeteorAtomWithMongo = function (document) {                                       // 48
  if (EJSON.isBinary(document)) {                                                            // 49
    // This does more copies than we'd like, but is necessary because                        // 50
    // MongoDB.BSON only looks like it takes a Uint8Array (and doesn't actually              // 51
    // serialize it correctly).                                                              // 52
    return new MongoDB.Binary(new Buffer(document));                                         // 53
  }                                                                                          // 54
  if (document instanceof Meteor.Collection.ObjectID) {                                      // 55
    return new MongoDB.ObjectID(document.toHexString());                                     // 56
  } else if (EJSON._isCustomType(document)) {                                                // 57
    return replaceNames(makeMongoLegal, EJSON.toJSONValue(document));                        // 58
  }                                                                                          // 59
  // It is not ordinarily possible to stick dollar-sign keys into mongo                      // 60
  // so we don't bother checking for things that need escaping at this time.                 // 61
  return undefined;                                                                          // 62
};                                                                                           // 63
                                                                                             // 64
var replaceTypes = function (document, atomTransformer) {                                    // 65
  if (typeof document !== 'object' || document === null)                                     // 66
    return document;                                                                         // 67
                                                                                             // 68
  var replacedTopLevelAtom = atomTransformer(document);                                      // 69
  if (replacedTopLevelAtom !== undefined)                                                    // 70
    return replacedTopLevelAtom;                                                             // 71
                                                                                             // 72
  var ret = document;                                                                        // 73
  _.each(document, function (val, key) {                                                     // 74
    var valReplaced = replaceTypes(val, atomTransformer);                                    // 75
    if (val !== valReplaced) {                                                               // 76
      // Lazy clone. Shallow copy.                                                           // 77
      if (ret === document)                                                                  // 78
        ret = _.clone(document);                                                             // 79
      ret[key] = valReplaced;                                                                // 80
    }                                                                                        // 81
  });                                                                                        // 82
  return ret;                                                                                // 83
};                                                                                           // 84
                                                                                             // 85
                                                                                             // 86
MongoConnection = function (url) {                                                           // 87
  var self = this;                                                                           // 88
  self._connectCallbacks = [];                                                               // 89
  self._liveResultsSets = {};                                                                // 90
                                                                                             // 91
  var options = {db: {safe: true}};                                                          // 92
                                                                                             // 93
  // Set autoReconnect to true, unless passed on the URL. Why someone                        // 94
  // would want to set autoReconnect to false, I'm not really sure, but                      // 95
  // keeping this for backwards compatibility for now.                                       // 96
  if (!(/[\?&]auto_?[rR]econnect=/.test(url))) {                                             // 97
    options.server = {auto_reconnect: true};                                                 // 98
  }                                                                                          // 99
                                                                                             // 100
  // Disable the native parser by default, unless specifically enabled                       // 101
  // in the mongo URL.                                                                       // 102
  // - The native driver can cause errors which normally would be                            // 103
  //   thrown, caught, and handled into segfaults that take down the                         // 104
  //   whole app.                                                                            // 105
  // - Binary modules don't yet work when you bundle and move the bundle                     // 106
  //   to a different platform (aka deploy)                                                  // 107
  // We should revisit this after binary npm module support lands.                           // 108
  if (!(/[\?&]native_?[pP]arser=/.test(url))) {                                              // 109
    options.db.native_parser = false;                                                        // 110
  }                                                                                          // 111
                                                                                             // 112
  MongoDB.connect(url, options, function(err, db) {                                          // 113
    if (err)                                                                                 // 114
      throw err;                                                                             // 115
    self.db = db;                                                                            // 116
                                                                                             // 117
    Fiber(function () {                                                                      // 118
      // drain queue of pending callbacks                                                    // 119
      _.each(self._connectCallbacks, function (c) {                                          // 120
        c(db);                                                                               // 121
      });                                                                                    // 122
    }).run();                                                                                // 123
  });                                                                                        // 124
};                                                                                           // 125
                                                                                             // 126
MongoConnection.prototype.close = function() {                                               // 127
  var self = this;                                                                           // 128
  // Use Future.wrap so that errors get thrown. This happens to                              // 129
  // work even outside a fiber since the 'close' method is not                               // 130
  // actually asynchronous.                                                                  // 131
  Future.wrap(_.bind(self.db.close, self.db))(true).wait();                                  // 132
};                                                                                           // 133
                                                                                             // 134
MongoConnection.prototype._withDb = function (callback) {                                    // 135
  var self = this;                                                                           // 136
  if (self.db) {                                                                             // 137
    callback(self.db);                                                                       // 138
  } else {                                                                                   // 139
    self._connectCallbacks.push(callback);                                                   // 140
  }                                                                                          // 141
};                                                                                           // 142
                                                                                             // 143
// Returns the Mongo Collection object; may yield.                                           // 144
MongoConnection.prototype._getCollection = function (collectionName) {                       // 145
  var self = this;                                                                           // 146
                                                                                             // 147
  var future = new Future;                                                                   // 148
  self._withDb(function (db) {                                                               // 149
    db.collection(collectionName, future.resolver());                                        // 150
  });                                                                                        // 151
  return future.wait();                                                                      // 152
};                                                                                           // 153
                                                                                             // 154
MongoConnection.prototype._createCappedCollection = function (collectionName,                // 155
                                                              byteSize) {                    // 156
  var self = this;                                                                           // 157
  var future = new Future();                                                                 // 158
  self._withDb(function (db) {                                                               // 159
    db.createCollection(collectionName, {capped: true, size: byteSize},                      // 160
                        future.resolver());                                                  // 161
  });                                                                                        // 162
  future.wait();                                                                             // 163
};                                                                                           // 164
                                                                                             // 165
// This should be called synchronously with a write, to create a                             // 166
// transaction on the current write fence, if any. After we can read                         // 167
// the write, and after observers have been notified (or at least,                           // 168
// after the observer notifiers have added themselves to the write                           // 169
// fence), you should call 'committed()' on the object returned.                             // 170
MongoConnection.prototype._maybeBeginWrite = function () {                                   // 171
  var self = this;                                                                           // 172
  var fence = DDPServer._CurrentWriteFence.get();                                            // 173
  if (fence)                                                                                 // 174
    return fence.beginWrite();                                                               // 175
  else                                                                                       // 176
    return {committed: function () {}};                                                      // 177
};                                                                                           // 178
                                                                                             // 179
//////////// Public API //////////                                                           // 180
                                                                                             // 181
// The write methods block until the database has confirmed the write (it may                // 182
// not be replicated or stable on disk, but one server has confirmed it) if no               // 183
// callback is provided. If a callback is provided, then they call the callback              // 184
// when the write is confirmed. They return nothing on success, and raise an                 // 185
// exception on failure.                                                                     // 186
//                                                                                           // 187
// After making a write (with insert, update, remove), observers are                         // 188
// notified asynchronously. If you want to receive a callback once all                       // 189
// of the observer notifications have landed for your write, do the                          // 190
// writes inside a write fence (set DDPServer._CurrentWriteFence to a new                    // 191
// _WriteFence, and then set a callback on the write fence.)                                 // 192
//                                                                                           // 193
// Since our execution environment is single-threaded, this is                               // 194
// well-defined -- a write "has been made" if it's returned, and an                          // 195
// observer "has been notified" if its callback has returned.                                // 196
                                                                                             // 197
var writeCallback = function (write, refresh, callback) {                                    // 198
  return Meteor.bindEnvironment(function (err, result) {                                     // 199
    if (! err) {                                                                             // 200
      // XXX We don't have to run this on error, right?                                      // 201
      refresh();                                                                             // 202
    }                                                                                        // 203
    write.committed();                                                                       // 204
    if (callback)                                                                            // 205
      callback(err, result);                                                                 // 206
    else if (err)                                                                            // 207
      throw err;                                                                             // 208
  }, function (err) {                                                                        // 209
    Meteor._debug("Error in Mongo write:", err.stack);                                       // 210
  });                                                                                        // 211
};                                                                                           // 212
                                                                                             // 213
MongoConnection.prototype._insert = function (collection_name, document,                     // 214
                                              callback) {                                    // 215
  var self = this;                                                                           // 216
  if (collection_name === "___meteor_failure_test_collection") {                             // 217
    var e = new Error("Failure test");                                                       // 218
    e.expected = true;                                                                       // 219
    if (callback)                                                                            // 220
      return callback(e);                                                                    // 221
    else                                                                                     // 222
      throw e;                                                                               // 223
  }                                                                                          // 224
                                                                                             // 225
  var write = self._maybeBeginWrite();                                                       // 226
  var refresh = function () {                                                                // 227
    Meteor.refresh({ collection: collection_name, id: document._id });                       // 228
  };                                                                                         // 229
  callback = writeCallback(write, refresh, callback);                                        // 230
  try {                                                                                      // 231
    var collection = self._getCollection(collection_name);                                   // 232
    collection.insert(replaceTypes(document, replaceMeteorAtomWithMongo),                    // 233
                      {safe: true}, callback);                                               // 234
  } catch (e) {                                                                              // 235
    write.committed();                                                                       // 236
    throw e;                                                                                 // 237
  }                                                                                          // 238
};                                                                                           // 239
                                                                                             // 240
// Cause queries that may be affected by the selector to poll in this write                  // 241
// fence.                                                                                    // 242
MongoConnection.prototype._refresh = function (collectionName, selector) {                   // 243
  var self = this;                                                                           // 244
  var refreshKey = {collection: collectionName};                                             // 245
  // If we know which documents we're removing, don't poll queries that are                  // 246
  // specific to other documents. (Note that multiple notifications here should              // 247
  // not cause multiple polls, since all our listener is doing is enqueueing a               // 248
  // poll.)                                                                                  // 249
  var specificIds = LocalCollection._idsMatchedBySelector(selector);                         // 250
  if (specificIds) {                                                                         // 251
    _.each(specificIds, function (id) {                                                      // 252
      Meteor.refresh(_.extend({id: id}, refreshKey));                                        // 253
    });                                                                                      // 254
  } else {                                                                                   // 255
    Meteor.refresh(refreshKey);                                                              // 256
  }                                                                                          // 257
};                                                                                           // 258
                                                                                             // 259
MongoConnection.prototype._remove = function (collection_name, selector,                     // 260
                                              callback) {                                    // 261
  var self = this;                                                                           // 262
                                                                                             // 263
  if (collection_name === "___meteor_failure_test_collection") {                             // 264
    var e = new Error("Failure test");                                                       // 265
    e.expected = true;                                                                       // 266
    if (callback)                                                                            // 267
      return callback(e);                                                                    // 268
    else                                                                                     // 269
      throw e;                                                                               // 270
  }                                                                                          // 271
                                                                                             // 272
  var write = self._maybeBeginWrite();                                                       // 273
  var refresh = function () {                                                                // 274
    self._refresh(collection_name, selector);                                                // 275
  };                                                                                         // 276
  callback = writeCallback(write, refresh, callback);                                        // 277
                                                                                             // 278
  try {                                                                                      // 279
    var collection = self._getCollection(collection_name);                                   // 280
    collection.remove(replaceTypes(selector, replaceMeteorAtomWithMongo),                    // 281
                      {safe: true}, callback);                                               // 282
  } catch (e) {                                                                              // 283
    write.committed();                                                                       // 284
    throw e;                                                                                 // 285
  }                                                                                          // 286
};                                                                                           // 287
                                                                                             // 288
MongoConnection.prototype._update = function (collection_name, selector, mod,                // 289
                                              options, callback) {                           // 290
  var self = this;                                                                           // 291
                                                                                             // 292
  if (! callback && options instanceof Function) {                                           // 293
    callback = options;                                                                      // 294
    options = null;                                                                          // 295
  }                                                                                          // 296
                                                                                             // 297
  if (collection_name === "___meteor_failure_test_collection") {                             // 298
    var e = new Error("Failure test");                                                       // 299
    e.expected = true;                                                                       // 300
    if (callback)                                                                            // 301
      return callback(e);                                                                    // 302
    else                                                                                     // 303
      throw e;                                                                               // 304
  }                                                                                          // 305
                                                                                             // 306
  // explicit safety check. null and undefined can crash the mongo                           // 307
  // driver. Although the node driver and minimongo do 'support'                             // 308
  // non-object modifier in that they don't crash, they are not                              // 309
  // meaningful operations and do not do anything. Defensively throw an                      // 310
  // error here.                                                                             // 311
  if (!mod || typeof mod !== 'object')                                                       // 312
    throw new Error("Invalid modifier. Modifier must be an object.");                        // 313
                                                                                             // 314
  if (!options) options = {};                                                                // 315
                                                                                             // 316
  var write = self._maybeBeginWrite();                                                       // 317
  var refresh = function () {                                                                // 318
    self._refresh(collection_name, selector);                                                // 319
  };                                                                                         // 320
  callback = writeCallback(write, refresh, callback);                                        // 321
  try {                                                                                      // 322
    var collection = self._getCollection(collection_name);                                   // 323
    var mongoOpts = {safe: true};                                                            // 324
    // explictly enumerate options that minimongo supports                                   // 325
    if (options.upsert) mongoOpts.upsert = true;                                             // 326
    if (options.multi) mongoOpts.multi = true;                                               // 327
    collection.update(replaceTypes(selector, replaceMeteorAtomWithMongo),                    // 328
                      replaceTypes(mod, replaceMeteorAtomWithMongo),                         // 329
                      mongoOpts, callback);                                                  // 330
  } catch (e) {                                                                              // 331
    write.committed();                                                                       // 332
    throw e;                                                                                 // 333
  }                                                                                          // 334
};                                                                                           // 335
                                                                                             // 336
_.each(["insert", "update", "remove"], function (method) {                                   // 337
  MongoConnection.prototype[method] = function (/* arguments */) {                           // 338
    var self = this;                                                                         // 339
    return Meteor._wrapAsync(self["_" + method]).apply(self, arguments);                     // 340
  };                                                                                         // 341
});                                                                                          // 342
                                                                                             // 343
MongoConnection.prototype.find = function (collectionName, selector, options) {              // 344
  var self = this;                                                                           // 345
                                                                                             // 346
  if (arguments.length === 1)                                                                // 347
    selector = {};                                                                           // 348
                                                                                             // 349
  return new Cursor(                                                                         // 350
    self, new CursorDescription(collectionName, selector, options));                         // 351
};                                                                                           // 352
                                                                                             // 353
MongoConnection.prototype.findOne = function (collection_name, selector,                     // 354
                                              options) {                                     // 355
  var self = this;                                                                           // 356
  if (arguments.length === 1)                                                                // 357
    selector = {};                                                                           // 358
                                                                                             // 359
  options = options || {};                                                                   // 360
  options.limit = 1;                                                                         // 361
  return self.find(collection_name, selector, options).fetch()[0];                           // 362
};                                                                                           // 363
                                                                                             // 364
// We'll actually design an index API later. For now, we just pass through to                // 365
// Mongo's, but make it synchronous.                                                         // 366
MongoConnection.prototype._ensureIndex = function (collectionName, index,                    // 367
                                                   options) {                                // 368
  var self = this;                                                                           // 369
  options = _.extend({safe: true}, options);                                                 // 370
                                                                                             // 371
  // We expect this function to be called at startup, not from within a method,              // 372
  // so we don't interact with the write fence.                                              // 373
  var collection = self._getCollection(collectionName);                                      // 374
  var future = new Future;                                                                   // 375
  var indexName = collection.ensureIndex(index, options, future.resolver());                 // 376
  future.wait();                                                                             // 377
};                                                                                           // 378
MongoConnection.prototype._dropIndex = function (collectionName, index) {                    // 379
  var self = this;                                                                           // 380
                                                                                             // 381
  // This function is only used by test code, not within a method, so we don't               // 382
  // interact with the write fence.                                                          // 383
  var collection = self._getCollection(collectionName);                                      // 384
  var future = new Future;                                                                   // 385
  var indexName = collection.dropIndex(index, future.resolver());                            // 386
  future.wait();                                                                             // 387
};                                                                                           // 388
                                                                                             // 389
// CURSORS                                                                                   // 390
                                                                                             // 391
// There are several classes which relate to cursors:                                        // 392
//                                                                                           // 393
// CursorDescription represents the arguments used to construct a cursor:                    // 394
// collectionName, selector, and (find) options.  Because it is used as a key                // 395
// for cursor de-dup, everything in it should either be JSON-stringifiable or                // 396
// not affect observeChanges output (eg, options.transform functions are not                 // 397
// stringifiable but do not affect observeChanges).                                          // 398
//                                                                                           // 399
// SynchronousCursor is a wrapper around a MongoDB cursor                                    // 400
// which includes fully-synchronous versions of forEach, etc.                                // 401
//                                                                                           // 402
// Cursor is the cursor object returned from find(), which implements the                    // 403
// documented Meteor.Collection cursor API.  It wraps a CursorDescription and a              // 404
// SynchronousCursor (lazily: it doesn't contact Mongo until you call a method               // 405
// like fetch or forEach on it).                                                             // 406
//                                                                                           // 407
// ObserveHandle is the "observe handle" returned from observeChanges. It has a              // 408
// reference to a LiveResultsSet.                                                            // 409
//                                                                                           // 410
// LiveResultsSet caches the results of a query and reruns it when necessary.                // 411
// It is hooked up to one or more ObserveHandles; a single LiveResultsSet                    // 412
// can drive multiple sets of observation callbacks if they are for the                      // 413
// same query.                                                                               // 414
                                                                                             // 415
                                                                                             // 416
var CursorDescription = function (collectionName, selector, options) {                       // 417
  var self = this;                                                                           // 418
  self.collectionName = collectionName;                                                      // 419
  self.selector = Meteor.Collection._rewriteSelector(selector);                              // 420
  self.options = options || {};                                                              // 421
};                                                                                           // 422
                                                                                             // 423
var Cursor = function (mongo, cursorDescription) {                                           // 424
  var self = this;                                                                           // 425
                                                                                             // 426
  self._mongo = mongo;                                                                       // 427
  self._cursorDescription = cursorDescription;                                               // 428
  self._synchronousCursor = null;                                                            // 429
};                                                                                           // 430
                                                                                             // 431
_.each(['forEach', 'map', 'rewind', 'fetch', 'count'], function (method) {                   // 432
  Cursor.prototype[method] = function () {                                                   // 433
    var self = this;                                                                         // 434
                                                                                             // 435
    // You can only observe a tailable cursor.                                               // 436
    if (self._cursorDescription.options.tailable)                                            // 437
      throw new Error("Cannot call " + method + " on a tailable cursor");                    // 438
                                                                                             // 439
    if (!self._synchronousCursor)                                                            // 440
      self._synchronousCursor = self._mongo._createSynchronousCursor(                        // 441
        self._cursorDescription, true);                                                      // 442
                                                                                             // 443
    return self._synchronousCursor[method].apply(                                            // 444
      self._synchronousCursor, arguments);                                                   // 445
  };                                                                                         // 446
});                                                                                          // 447
                                                                                             // 448
Cursor.prototype.getTransform = function () {                                                // 449
  var self = this;                                                                           // 450
  return self._cursorDescription.options.transform;                                          // 451
};                                                                                           // 452
                                                                                             // 453
// When you call Meteor.publish() with a function that returns a Cursor, we need             // 454
// to transmute it into the equivalent subscription.  This is the function that              // 455
// does that.                                                                                // 456
                                                                                             // 457
Cursor.prototype._publishCursor = function (sub) {                                           // 458
  var self = this;                                                                           // 459
  var collection = self._cursorDescription.collectionName;                                   // 460
  return Meteor.Collection._publishCursor(self, sub, collection);                            // 461
};                                                                                           // 462
                                                                                             // 463
// Used to guarantee that publish functions return at most one cursor per                    // 464
// collection. Private, because we might later have cursors that include                     // 465
// documents from multiple collections somehow.                                              // 466
Cursor.prototype._getCollectionName = function () {                                          // 467
  var self = this;                                                                           // 468
  return self._cursorDescription.collectionName;                                             // 469
}                                                                                            // 470
                                                                                             // 471
Cursor.prototype.observe = function (callbacks) {                                            // 472
  var self = this;                                                                           // 473
  return LocalCollection._observeFromObserveChanges(self, callbacks);                        // 474
};                                                                                           // 475
                                                                                             // 476
Cursor.prototype.observeChanges = function (callbacks) {                                     // 477
  var self = this;                                                                           // 478
  var ordered = LocalCollection._isOrderedChanges(callbacks);                                // 479
  return self._mongo._observeChanges(                                                        // 480
    self._cursorDescription, ordered, callbacks);                                            // 481
};                                                                                           // 482
                                                                                             // 483
MongoConnection.prototype._createSynchronousCursor = function(cursorDescription,             // 484
                                                              useTransform) {                // 485
  var self = this;                                                                           // 486
                                                                                             // 487
  var collection = self._getCollection(cursorDescription.collectionName);                    // 488
  var options = cursorDescription.options;                                                   // 489
  var mongoOptions = {                                                                       // 490
    sort: options.sort,                                                                      // 491
    limit: options.limit,                                                                    // 492
    skip: options.skip                                                                       // 493
  };                                                                                         // 494
                                                                                             // 495
  // Do we want a tailable cursor (which only works on capped collections)?                  // 496
  if (options.tailable) {                                                                    // 497
    // We want a tailable cursor...                                                          // 498
    mongoOptions.tailable = true;                                                            // 499
    // ... and for the server to wait a bit if any getMore has no data (rather               // 500
    // than making us put the relevant sleeps in the client)...                              // 501
    mongoOptions.awaitdata = true;                                                           // 502
    // ... and to keep querying the server indefinitely rather than just 5 times             // 503
    // if there's no more data.                                                              // 504
    mongoOptions.numberOfRetries = -1;                                                       // 505
  }                                                                                          // 506
                                                                                             // 507
  var dbCursor = collection.find(                                                            // 508
    replaceTypes(cursorDescription.selector, replaceMeteorAtomWithMongo),                    // 509
    options.fields, mongoOptions);                                                           // 510
                                                                                             // 511
  return new SynchronousCursor(dbCursor, cursorDescription, useTransform);                   // 512
};                                                                                           // 513
                                                                                             // 514
var SynchronousCursor = function (dbCursor, cursorDescription, useTransform) {               // 515
  var self = this;                                                                           // 516
  self._dbCursor = dbCursor;                                                                 // 517
  self._cursorDescription = cursorDescription;                                               // 518
  if (useTransform && cursorDescription.options.transform) {                                 // 519
    self._transform = Deps._makeNonreactive(                                                 // 520
      cursorDescription.options.transform                                                    // 521
    );                                                                                       // 522
  } else {                                                                                   // 523
    self._transform = null;                                                                  // 524
  }                                                                                          // 525
                                                                                             // 526
  // Need to specify that the callback is the first argument to nextObject,                  // 527
  // since otherwise when we try to call it with no args the driver will                     // 528
  // interpret "undefined" first arg as an options hash and crash.                           // 529
  self._synchronousNextObject = Future.wrap(                                                 // 530
    dbCursor.nextObject.bind(dbCursor), 0);                                                  // 531
  self._synchronousCount = Future.wrap(dbCursor.count.bind(dbCursor));                       // 532
  self._visitedIds = {};                                                                     // 533
};                                                                                           // 534
                                                                                             // 535
_.extend(SynchronousCursor.prototype, {                                                      // 536
  _nextObject: function () {                                                                 // 537
    var self = this;                                                                         // 538
    while (true) {                                                                           // 539
      var doc = self._synchronousNextObject().wait();                                        // 540
      if (!doc || !doc._id) return null;                                                     // 541
      doc = replaceTypes(doc, replaceMongoAtomWithMeteor);                                   // 542
                                                                                             // 543
      if (!self._cursorDescription.options.tailable) {                                       // 544
        // Did Mongo give us duplicate documents in the same cursor? If so,                  // 545
        // ignore this one. (Do this before the transform, since transform might             // 546
        // return some unrelated value.) We don't do this for tailable cursors,              // 547
        // because we want to maintain O(1) memory usage.                                    // 548
        var strId = LocalCollection._idStringify(doc._id);                                   // 549
        if (self._visitedIds[strId]) continue;                                               // 550
        self._visitedIds[strId] = true;                                                      // 551
      }                                                                                      // 552
                                                                                             // 553
      if (self._transform)                                                                   // 554
        doc = self._transform(doc);                                                          // 555
                                                                                             // 556
      return doc;                                                                            // 557
    }                                                                                        // 558
  },                                                                                         // 559
                                                                                             // 560
  // XXX Make more like ECMA forEach:                                                        // 561
  //     https://github.com/meteor/meteor/pull/63#issuecomment-5320050                       // 562
  forEach: function (callback) {                                                             // 563
    var self = this;                                                                         // 564
                                                                                             // 565
    // We implement the loop ourself instead of using self._dbCursor.each,                   // 566
    // because "each" will call its callback outside of a fiber which makes it               // 567
    // much more complex to make this function synchronous.                                  // 568
    while (true) {                                                                           // 569
      var doc = self._nextObject();                                                          // 570
      if (!doc) return;                                                                      // 571
      callback(doc);                                                                         // 572
    }                                                                                        // 573
  },                                                                                         // 574
                                                                                             // 575
  // XXX Make more like ECMA map:                                                            // 576
  //     https://github.com/meteor/meteor/pull/63#issuecomment-5320050                       // 577
  // XXX Allow overlapping callback executions if callback yields.                           // 578
  map: function (callback) {                                                                 // 579
    var self = this;                                                                         // 580
    var res = [];                                                                            // 581
    self.forEach(function (doc) {                                                            // 582
      res.push(callback(doc));                                                               // 583
    });                                                                                      // 584
    return res;                                                                              // 585
  },                                                                                         // 586
                                                                                             // 587
  rewind: function () {                                                                      // 588
    var self = this;                                                                         // 589
                                                                                             // 590
    // known to be synchronous                                                               // 591
    self._dbCursor.rewind();                                                                 // 592
                                                                                             // 593
    self._visitedIds = {};                                                                   // 594
  },                                                                                         // 595
                                                                                             // 596
  // Mostly usable for tailable cursors.                                                     // 597
  close: function () {                                                                       // 598
    var self = this;                                                                         // 599
                                                                                             // 600
    self._dbCursor.close();                                                                  // 601
  },                                                                                         // 602
                                                                                             // 603
  fetch: function () {                                                                       // 604
    var self = this;                                                                         // 605
    return self.map(_.identity);                                                             // 606
  },                                                                                         // 607
                                                                                             // 608
  count: function () {                                                                       // 609
    var self = this;                                                                         // 610
    return self._synchronousCount().wait();                                                  // 611
  },                                                                                         // 612
                                                                                             // 613
  // This method is NOT wrapped in Cursor.                                                   // 614
  getRawObjects: function (ordered) {                                                        // 615
    var self = this;                                                                         // 616
    if (ordered) {                                                                           // 617
      return self.fetch();                                                                   // 618
    } else {                                                                                 // 619
      var results = {};                                                                      // 620
      self.forEach(function (doc) {                                                          // 621
        results[doc._id] = doc;                                                              // 622
      });                                                                                    // 623
      return results;                                                                        // 624
    }                                                                                        // 625
  }                                                                                          // 626
});                                                                                          // 627
                                                                                             // 628
var nextObserveHandleId = 1;                                                                 // 629
var ObserveHandle = function (liveResultsSet, callbacks) {                                   // 630
  var self = this;                                                                           // 631
  self._liveResultsSet = liveResultsSet;                                                     // 632
  self._added = callbacks.added;                                                             // 633
  self._addedBefore = callbacks.addedBefore;                                                 // 634
  self._changed = callbacks.changed;                                                         // 635
  self._removed = callbacks.removed;                                                         // 636
  self._moved = callbacks.moved;                                                             // 637
  self._movedBefore = callbacks.movedBefore;                                                 // 638
  self._observeHandleId = nextObserveHandleId++;                                             // 639
};                                                                                           // 640
ObserveHandle.prototype.stop = function () {                                                 // 641
  var self = this;                                                                           // 642
  self._liveResultsSet._removeObserveHandle(self);                                           // 643
  self._liveResultsSet = null;                                                               // 644
};                                                                                           // 645
                                                                                             // 646
MongoConnection.prototype._observeChanges = function (                                       // 647
    cursorDescription, ordered, callbacks) {                                                 // 648
  var self = this;                                                                           // 649
                                                                                             // 650
  if (cursorDescription.options.tailable) {                                                  // 651
    return self._observeChangesTailable(cursorDescription, ordered, callbacks);              // 652
  }                                                                                          // 653
                                                                                             // 654
  var observeKey = JSON.stringify(                                                           // 655
    _.extend({ordered: ordered}, cursorDescription));                                        // 656
                                                                                             // 657
  var liveResultsSet;                                                                        // 658
  var observeHandle;                                                                         // 659
  var newlyCreated = false;                                                                  // 660
                                                                                             // 661
  // Find a matching LiveResultsSet, or create a new one. This next block is                 // 662
  // guaranteed to not yield (and it doesn't call anything that can observe a                // 663
  // new query), so no other calls to this function can interleave with it.                  // 664
  Meteor._noYieldsAllowed(function () {                                                      // 665
    if (_.has(self._liveResultsSets, observeKey)) {                                          // 666
      liveResultsSet = self._liveResultsSets[observeKey];                                    // 667
    } else {                                                                                 // 668
      // Create a new LiveResultsSet. It is created "locked": no polling can                 // 669
      // take place.                                                                         // 670
      liveResultsSet = new LiveResultsSet(                                                   // 671
        cursorDescription,                                                                   // 672
        self,                                                                                // 673
        ordered,                                                                             // 674
        function () {                                                                        // 675
          delete self._liveResultsSets[observeKey];                                          // 676
        },                                                                                   // 677
        callbacks._testOnlyPollCallback);                                                    // 678
      self._liveResultsSets[observeKey] = liveResultsSet;                                    // 679
      newlyCreated = true;                                                                   // 680
    }                                                                                        // 681
    observeHandle = new ObserveHandle(liveResultsSet, callbacks);                            // 682
  });                                                                                        // 683
                                                                                             // 684
  if (newlyCreated) {                                                                        // 685
    // This is the first ObserveHandle on this LiveResultsSet.  Add it and run               // 686
    // the initial synchronous poll (which may yield).                                       // 687
    liveResultsSet._addFirstObserveHandle(observeHandle);                                    // 688
  } else {                                                                                   // 689
    // Not the first ObserveHandle. Add it to the LiveResultsSet. This call                  // 690
    // yields until we're not in the middle of a poll, and its invocation of the             // 691
    // initial 'added' callbacks may yield as well. It blocks until the 'added'              // 692
    // callbacks have fired.                                                                 // 693
    liveResultsSet._addObserveHandleAndSendInitialAdds(observeHandle);                       // 694
  }                                                                                          // 695
                                                                                             // 696
  return observeHandle;                                                                      // 697
};                                                                                           // 698
                                                                                             // 699
var LiveResultsSet = function (cursorDescription, mongoHandle, ordered,                      // 700
                               stopCallback, testOnlyPollCallback) {                         // 701
  var self = this;                                                                           // 702
                                                                                             // 703
  self._cursorDescription = cursorDescription;                                               // 704
  self._mongoHandle = mongoHandle;                                                           // 705
  self._ordered = ordered;                                                                   // 706
  self._stopCallbacks = [stopCallback];                                                      // 707
                                                                                             // 708
  // This constructor cannot yield, so we don't create the synchronousCursor yet             // 709
  // (since that can yield).                                                                 // 710
  self._synchronousCursor = null;                                                            // 711
                                                                                             // 712
  // previous results snapshot.  on each poll cycle, diffs against                           // 713
  // results drives the callbacks.                                                           // 714
  self._results = ordered ? [] : {};                                                         // 715
                                                                                             // 716
  // The number of _pollMongo calls that have been added to self._taskQueue but              // 717
  // have not started running. Used to make sure we never schedule more than one             // 718
  // _pollMongo (other than possibly the one that is currently running). It's                // 719
  // also used by _suspendPolling to pretend there's a poll scheduled. Usually,              // 720
  // it's either 0 (for "no polls scheduled other than maybe one currently                   // 721
  // running") or 1 (for "a poll scheduled that isn't running yet"), but it can              // 722
  // also be 2 if incremented by _suspendPolling.                                            // 723
  self._pollsScheduledButNotStarted = 0;                                                     // 724
  // Number of _addObserveHandleAndSendInitialAdds tasks scheduled but not yet               // 725
  // running. _removeObserveHandle uses this to know if it's safe to shut down               // 726
  // this LiveResultsSet.                                                                    // 727
  self._addHandleTasksScheduledButNotPerformed = 0;                                          // 728
  self._pendingWrites = []; // people to notify when polling completes                       // 729
                                                                                             // 730
  // Make sure to create a separately throttled function for each LiveResultsSet             // 731
  // object.                                                                                 // 732
  self._ensurePollIsScheduled = _.throttle(                                                  // 733
    self._unthrottledEnsurePollIsScheduled, 50 /* ms */);                                    // 734
                                                                                             // 735
  self._taskQueue = new Meteor._SynchronousQueue();                                          // 736
                                                                                             // 737
  // Listen for the invalidation messages that will trigger us to poll the                   // 738
  // database for changes. If this selector specifies specific IDs, specify them             // 739
  // here, so that updates to different specific IDs don't cause us to poll.                 // 740
  var listenOnTrigger = function (trigger) {                                                 // 741
    var listener = DDPServer._InvalidationCrossbar.listen(                                   // 742
      trigger, function (notification, complete) {                                           // 743
        // When someone does a transaction that might affect us, schedule a poll             // 744
        // of the database. If that transaction happens inside of a write fence,             // 745
        // block the fence until we've polled and notified observers.                        // 746
        var fence = DDPServer._CurrentWriteFence.get();                                      // 747
        if (fence)                                                                           // 748
          self._pendingWrites.push(fence.beginWrite());                                      // 749
        // Ensure a poll is scheduled... but if we already know that one is,                 // 750
        // don't hit the throttled _ensurePollIsScheduled function (which might              // 751
        // lead to us calling it unnecessarily in 50ms).                                     // 752
        if (self._pollsScheduledButNotStarted === 0)                                         // 753
          self._ensurePollIsScheduled();                                                     // 754
        complete();                                                                          // 755
      });                                                                                    // 756
    self._stopCallbacks.push(function () { listener.stop(); });                              // 757
  };                                                                                         // 758
  var key = {collection: cursorDescription.collectionName};                                  // 759
  var specificIds = LocalCollection._idsMatchedBySelector(                                   // 760
    cursorDescription.selector);                                                             // 761
  if (specificIds) {                                                                         // 762
    _.each(specificIds, function (id) {                                                      // 763
      listenOnTrigger(_.extend({id: id}, key));                                              // 764
    });                                                                                      // 765
  } else {                                                                                   // 766
    listenOnTrigger(key);                                                                    // 767
  }                                                                                          // 768
                                                                                             // 769
  // Map from handle ID to ObserveHandle.                                                    // 770
  self._observeHandles = {};                                                                 // 771
                                                                                             // 772
  self._callbackMultiplexer = {};                                                            // 773
  var callbackNames = ['added', 'changed', 'removed'];                                       // 774
  if (self._ordered) {                                                                       // 775
    callbackNames.push('moved');                                                             // 776
    callbackNames.push('addedBefore');                                                       // 777
    callbackNames.push('movedBefore');                                                       // 778
  }                                                                                          // 779
  _.each(callbackNames, function (callback) {                                                // 780
    var handleCallback = '_' + callback;                                                     // 781
    self._callbackMultiplexer[callback] = function () {                                      // 782
      var args = _.toArray(arguments);                                                       // 783
      // Because callbacks can yield and _removeObserveHandle() (ie,                         // 784
      // handle.stop()) doesn't synchronize its actions with _taskQueue,                     // 785
      // ObserveHandles can disappear from self._observeHandles during this                  // 786
      // dispatch. Thus, we save a copy of the keys of self._observeHandles                  // 787
      // before we start to iterate, and we check to see if the handle is still              // 788
      // there each time.                                                                    // 789
      _.each(_.keys(self._observeHandles), function (handleId) {                             // 790
        var handle = self._observeHandles[handleId];                                         // 791
        if (handle && handle[handleCallback])                                                // 792
          handle[handleCallback].apply(null, EJSON.clone(args));                             // 793
      });                                                                                    // 794
    };                                                                                       // 795
  });                                                                                        // 796
                                                                                             // 797
  // every once and a while, poll even if we don't think we're dirty, for                    // 798
  // eventual consistency with database writes from outside the Meteor                       // 799
  // universe.                                                                               // 800
  //                                                                                         // 801
  // For testing, there's an undocumented callback argument to observeChanges                // 802
  // which disables time-based polling and gets called at the beginning of each              // 803
  // poll.                                                                                   // 804
  if (testOnlyPollCallback) {                                                                // 805
    self._testOnlyPollCallback = testOnlyPollCallback;                                       // 806
  } else {                                                                                   // 807
    var intervalHandle = Meteor.setInterval(                                                 // 808
      _.bind(self._ensurePollIsScheduled, self), 10 * 1000);                                 // 809
    self._stopCallbacks.push(function () {                                                   // 810
      Meteor.clearInterval(intervalHandle);                                                  // 811
    });                                                                                      // 812
  }                                                                                          // 813
};                                                                                           // 814
                                                                                             // 815
_.extend(LiveResultsSet.prototype, {                                                         // 816
  _addFirstObserveHandle: function (handle) {                                                // 817
    var self = this;                                                                         // 818
    if (! _.isEmpty(self._observeHandles))                                                   // 819
      throw new Error("Not the first observe handle!");                                      // 820
    if (! _.isEmpty(self._results))                                                          // 821
      throw new Error("Call _addFirstObserveHandle before polling!");                        // 822
                                                                                             // 823
    self._observeHandles[handle._observeHandleId] = handle;                                  // 824
                                                                                             // 825
    // Run the first _poll() cycle synchronously (delivering results to the                  // 826
    // first ObserveHandle).                                                                 // 827
    ++self._pollsScheduledButNotStarted;                                                     // 828
    self._taskQueue.runTask(function () {                                                    // 829
      self._pollMongo();                                                                     // 830
    });                                                                                      // 831
  },                                                                                         // 832
                                                                                             // 833
  // This is always called through _.throttle.                                               // 834
  _unthrottledEnsurePollIsScheduled: function () {                                           // 835
    var self = this;                                                                         // 836
    if (self._pollsScheduledButNotStarted > 0)                                               // 837
      return;                                                                                // 838
    ++self._pollsScheduledButNotStarted;                                                     // 839
    self._taskQueue.queueTask(function () {                                                  // 840
      self._pollMongo();                                                                     // 841
    });                                                                                      // 842
  },                                                                                         // 843
                                                                                             // 844
  // test-only interface for controlling polling.                                            // 845
  //                                                                                         // 846
  // _suspendPolling blocks until any currently running and scheduled polls are              // 847
  // done, and prevents any further polls from being scheduled. (new                         // 848
  // ObserveHandles can be added and receive their initial added callbacks,                  // 849
  // though.)                                                                                // 850
  //                                                                                         // 851
  // _resumePolling immediately polls, and allows further polls to occur.                    // 852
  _suspendPolling: function() {                                                              // 853
    var self = this;                                                                         // 854
    // Pretend that there's another poll scheduled (which will prevent                       // 855
    // _ensurePollIsScheduled from queueing any more polls).                                 // 856
    ++self._pollsScheduledButNotStarted;                                                     // 857
    // Now block until all currently running or scheduled polls are done.                    // 858
    self._taskQueue.runTask(function() {});                                                  // 859
                                                                                             // 860
    // Confirm that there is only one "poll" (the fake one we're pretending to               // 861
    // have) scheduled.                                                                      // 862
    if (self._pollsScheduledButNotStarted !== 1)                                             // 863
      throw new Error("_pollsScheduledButNotStarted is " +                                   // 864
                      self._pollsScheduledButNotStarted);                                    // 865
  },                                                                                         // 866
  _resumePolling: function() {                                                               // 867
    var self = this;                                                                         // 868
    // We should be in the same state as in the end of _suspendPolling.                      // 869
    if (self._pollsScheduledButNotStarted !== 1)                                             // 870
      throw new Error("_pollsScheduledButNotStarted is " +                                   // 871
                      self._pollsScheduledButNotStarted);                                    // 872
    // Run a poll synchronously (which will counteract the                                   // 873
    // ++_pollsScheduledButNotStarted from _suspendPolling).                                 // 874
    self._taskQueue.runTask(function () {                                                    // 875
      self._pollMongo();                                                                     // 876
    });                                                                                      // 877
  },                                                                                         // 878
                                                                                             // 879
  _pollMongo: function () {                                                                  // 880
    var self = this;                                                                         // 881
    --self._pollsScheduledButNotStarted;                                                     // 882
                                                                                             // 883
    self._testOnlyPollCallback && self._testOnlyPollCallback();                              // 884
                                                                                             // 885
    // Save the list of pending writes which this round will commit.                         // 886
    var writesForCycle = self._pendingWrites;                                                // 887
    self._pendingWrites = [];                                                                // 888
                                                                                             // 889
    // Get the new query results. (These calls can yield.)                                   // 890
    if (self._synchronousCursor) {                                                           // 891
      self._synchronousCursor.rewind();                                                      // 892
    } else {                                                                                 // 893
      self._synchronousCursor = self._mongoHandle._createSynchronousCursor(                  // 894
        self._cursorDescription, false /* !useTransform */);                                 // 895
    }                                                                                        // 896
    var newResults = self._synchronousCursor.getRawObjects(self._ordered);                   // 897
    var oldResults = self._results;                                                          // 898
                                                                                             // 899
    // Run diffs. (This can yield too.)                                                      // 900
    if (!_.isEmpty(self._observeHandles)) {                                                  // 901
      LocalCollection._diffQueryChanges(                                                     // 902
        self._ordered, oldResults, newResults, self._callbackMultiplexer);                   // 903
    }                                                                                        // 904
                                                                                             // 905
    // Replace self._results atomically.                                                     // 906
    self._results = newResults;                                                              // 907
                                                                                             // 908
    // Mark all the writes which existed before this call as commmitted. (If new             // 909
    // writes have shown up in the meantime, there'll already be another                     // 910
    // _pollMongo task scheduled.)                                                           // 911
    _.each(writesForCycle, function (w) {w.committed();});                                   // 912
  },                                                                                         // 913
                                                                                             // 914
  // Adds the observe handle to this set and sends its initial added                         // 915
  // callbacks. Meteor._SynchronousQueue guarantees that this won't interleave               // 916
  // with a call to _pollMongo or another call to this function.                             // 917
  _addObserveHandleAndSendInitialAdds: function (handle) {                                   // 918
    var self = this;                                                                         // 919
                                                                                             // 920
    // Check this before calling runTask (even though runTask does the same                  // 921
    // check) so that we don't leak a LiveResultsSet by incrementing                         // 922
    // _addHandleTasksScheduledButNotPerformed and never decrementing it.                    // 923
    if (!self._taskQueue.safeToRunTask())                                                    // 924
      throw new Error(                                                                       // 925
        "Can't call observe() from an observe callback on the same query");                  // 926
                                                                                             // 927
    // Keep track of how many of these tasks are on the queue, so that                       // 928
    // _removeObserveHandle knows if it's safe to GC.                                        // 929
    ++self._addHandleTasksScheduledButNotPerformed;                                          // 930
                                                                                             // 931
    self._taskQueue.runTask(function () {                                                    // 932
      if (!self._observeHandles)                                                             // 933
        throw new Error("Can't add observe handle to stopped LiveResultsSet");               // 934
                                                                                             // 935
      if (_.has(self._observeHandles, handle._observeHandleId))                              // 936
        throw new Error("Duplicate observe handle ID");                                      // 937
      self._observeHandles[handle._observeHandleId] = handle;                                // 938
      --self._addHandleTasksScheduledButNotPerformed;                                        // 939
                                                                                             // 940
      // Send initial adds.                                                                  // 941
      if (handle._added || handle._addedBefore) {                                            // 942
        _.each(self._results, function (doc, i) {                                            // 943
          var fields = EJSON.clone(doc);                                                     // 944
          delete fields._id;                                                                 // 945
          if (self._ordered) {                                                               // 946
            handle._added && handle._added(doc._id, fields);                                 // 947
            handle._addedBefore && handle._addedBefore(doc._id, fields, null);               // 948
          } else {                                                                           // 949
            handle._added(doc._id, fields);                                                  // 950
          }                                                                                  // 951
        });                                                                                  // 952
      }                                                                                      // 953
    });                                                                                      // 954
  },                                                                                         // 955
                                                                                             // 956
  // Remove an observe handle. If it was the last observe handle, call all the               // 957
  // stop callbacks; you cannot add any more observe handles after this.                     // 958
  //                                                                                         // 959
  // This is not synchronized with polls and handle additions: this means that               // 960
  // you can safely call it from within an observe callback.                                 // 961
  _removeObserveHandle: function (handle) {                                                  // 962
    var self = this;                                                                         // 963
                                                                                             // 964
    if (!_.has(self._observeHandles, handle._observeHandleId))                               // 965
      throw new Error("Unknown observe handle ID " + handle._observeHandleId);               // 966
    delete self._observeHandles[handle._observeHandleId];                                    // 967
                                                                                             // 968
    if (_.isEmpty(self._observeHandles) &&                                                   // 969
        self._addHandleTasksScheduledButNotPerformed === 0) {                                // 970
      // The last observe handle was stopped; call our stop callbacks, which:                // 971
      //  - removes us from the MongoConnection's _liveResultsSets map                       // 972
      //  - stops the poll timer                                                             // 973
      //  - removes us from the invalidation crossbar                                        // 974
      _.each(self._stopCallbacks, function (c) { c(); });                                    // 975
      // This will cause future _addObserveHandleAndSendInitialAdds calls to                 // 976
      // throw.                                                                              // 977
      self._observeHandles = null;                                                           // 978
    }                                                                                        // 979
  }                                                                                          // 980
});                                                                                          // 981
                                                                                             // 982
// observeChanges for tailable cursors on capped collections.                                // 983
//                                                                                           // 984
// Some differences from normal cursors:                                                     // 985
//   - Will never produce anything other than 'added' or 'addedBefore'. If you               // 986
//     do update a document that has already been produced, this will not notice             // 987
//     it.                                                                                   // 988
//   - If you disconnect and reconnect from Mongo, it will essentially restart               // 989
//     the query, which will lead to duplicate results. This is pretty bad,                  // 990
//     but if you include a field called 'ts' which is inserted as                           // 991
//     new MongoInternals.MongoTimestamp(0, 0) (which is initialized to the                  // 992
//     current Mongo-style timestamp), we'll be able to find the place to                    // 993
//     restart properly. (This field is specifically understood by Mongo with an             // 994
//     optimization which allows it to find the right place to start without                 // 995
//     an index on ts. It's how the oplog works.)                                            // 996
//   - No callbacks are triggered synchronously with the call (there's no                    // 997
//     differentiation between "initial data" and "later changes"; everything                // 998
//     that matches the query gets sent asynchronously).                                     // 999
//   - De-duplication is not implemented.                                                    // 1000
//   - Does not yet interact with the write fence. Probably, this should work by             // 1001
//     ignoring removes (which don't work on capped collections) and updates                 // 1002
//     (which don't affect tailable cursors), and just keeping track of the ID               // 1003
//     of the inserted object, and closing the write fence once you get to that              // 1004
//     ID (or timestamp?).  This doesn't work well if the document doesn't match             // 1005
//     the query, though.  On the other hand, the write fence can close                      // 1006
//     immediately if it does not match the query. So if we trust minimongo                  // 1007
//     enough to accurately evaluate the query against the write fence, we                   // 1008
//     should be able to do this...  Of course, minimongo doesn't even support               // 1009
//     Mongo Timestamps yet.                                                                 // 1010
MongoConnection.prototype._observeChangesTailable = function (                               // 1011
    cursorDescription, ordered, callbacks) {                                                 // 1012
  var self = this;                                                                           // 1013
                                                                                             // 1014
  // Tailable cursors only ever call added/addedBefore callbacks, so it's an                 // 1015
  // error if you didn't provide them.                                                       // 1016
  if ((ordered && !callbacks.addedBefore) ||                                                 // 1017
      (!ordered && !callbacks.added)) {                                                      // 1018
    throw new Error("Can't observe an " + (ordered ? "ordered" : "unordered")                // 1019
                    + " tailable cursor without a "                                          // 1020
                    + (ordered ? "addedBefore" : "added") + " callback");                    // 1021
  }                                                                                          // 1022
  var cursor = self._createSynchronousCursor(cursorDescription,                              // 1023
                                            false /* useTransform */);                       // 1024
                                                                                             // 1025
  var stopped = false;                                                                       // 1026
  var lastTS = undefined;                                                                    // 1027
  Meteor.defer(function () {                                                                 // 1028
    while (true) {                                                                           // 1029
      if (stopped)                                                                           // 1030
        return;                                                                              // 1031
      try {                                                                                  // 1032
        var doc = cursor._nextObject();                                                      // 1033
      } catch (err) {                                                                        // 1034
        // There's no good way to figure out if this was actually an error from              // 1035
        // Mongo. Ah well. But either way, we need to retry the cursor (unless               // 1036
        // the failure was because the observe got stopped).                                 // 1037
        doc = null;                                                                          // 1038
      }                                                                                      // 1039
      if (stopped)                                                                           // 1040
        return;                                                                              // 1041
      if (doc) {                                                                             // 1042
        var id = doc._id;                                                                    // 1043
        delete doc._id;                                                                      // 1044
        // If a tailable cursor contains a "ts" field, use it to recreate the                // 1045
        // cursor on error, and don't publish the field. ("ts" is a standard                 // 1046
        // that Mongo uses internally for the oplog, and there's a special flag              // 1047
        // that lets you do binary search on it instead of needing to use an                 // 1048
        // index.)                                                                           // 1049
        lastTS = doc.ts;                                                                     // 1050
        delete doc.ts;                                                                       // 1051
        if (ordered) {                                                                       // 1052
          callbacks.addedBefore(id, doc, null);                                              // 1053
        } else {                                                                             // 1054
          callbacks.added(id, doc);                                                          // 1055
        }                                                                                    // 1056
      } else {                                                                               // 1057
        var newSelector = _.clone(cursorDescription.selector);                               // 1058
        if (lastTS) {                                                                        // 1059
          newSelector.ts = {$gt: lastTS};                                                    // 1060
        }                                                                                    // 1061
        // XXX maybe set replay flag                                                         // 1062
        cursor = self._createSynchronousCursor(new CursorDescription(                        // 1063
          cursorDescription.collectionName,                                                  // 1064
          newSelector,                                                                       // 1065
          cursorDescription.options), false /* useTransform */);                             // 1066
      }                                                                                      // 1067
    }                                                                                        // 1068
  });                                                                                        // 1069
                                                                                             // 1070
  return {                                                                                   // 1071
    stop: function () {                                                                      // 1072
      stopped = true;                                                                        // 1073
      cursor.close();                                                                        // 1074
    }                                                                                        // 1075
  };                                                                                         // 1076
};                                                                                           // 1077
                                                                                             // 1078
// XXX We probably need to find a better way to expose this. Right now                       // 1079
// it's only used by tests, but in fact you need it in normal                                // 1080
// operation to interact with capped collections (eg, Galaxy uses it).                       // 1081
MongoInternals.MongoTimestamp = MongoDB.Timestamp;                                           // 1082
                                                                                             // 1083
MongoInternals.Connection = MongoConnection;                                                 // 1084
                                                                                             // 1085
///////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

///////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                           //
// packages/mongo-livedata/local_collection_driver.js                                        //
//                                                                                           //
///////////////////////////////////////////////////////////////////////////////////////////////
                                                                                             //
LocalCollectionDriver = function () {                                                        // 1
  var self = this;                                                                           // 2
  self.noConnCollections = {};                                                               // 3
};                                                                                           // 4
                                                                                             // 5
var ensureCollection = function (name, collections) {                                        // 6
  if (!(name in collections))                                                                // 7
    collections[name] = new LocalCollection(name);                                           // 8
  return collections[name];                                                                  // 9
};                                                                                           // 10
                                                                                             // 11
_.extend(LocalCollectionDriver.prototype, {                                                  // 12
  open: function (name, conn) {                                                              // 13
    var self = this;                                                                         // 14
    if (!name)                                                                               // 15
      return new LocalCollection;                                                            // 16
    if (! conn) {                                                                            // 17
      return ensureCollection(name, self.noConnCollections);                                 // 18
    }                                                                                        // 19
    if (! conn._mongo_livedata_collections)                                                  // 20
      conn._mongo_livedata_collections = {};                                                 // 21
    // XXX is there a way to keep track of a connection's collections without                // 22
    // dangling it off the connection object?                                                // 23
    return ensureCollection(name, conn._mongo_livedata_collections);                         // 24
  }                                                                                          // 25
});                                                                                          // 26
                                                                                             // 27
// singleton                                                                                 // 28
LocalCollectionDriver = new LocalCollectionDriver;                                           // 29
                                                                                             // 30
///////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

///////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                           //
// packages/mongo-livedata/remote_collection_driver.js                                       //
//                                                                                           //
///////////////////////////////////////////////////////////////////////////////////////////////
                                                                                             //
MongoInternals.RemoteCollectionDriver = function (mongo_url) {                               // 1
  var self = this;                                                                           // 2
  self.mongo = new MongoConnection(mongo_url);                                               // 3
};                                                                                           // 4
                                                                                             // 5
_.extend(MongoInternals.RemoteCollectionDriver.prototype, {                                  // 6
  open: function (name) {                                                                    // 7
    var self = this;                                                                         // 8
    var ret = {};                                                                            // 9
    _.each(                                                                                  // 10
      ['find', 'findOne', 'insert', 'update', 'remove', '_ensureIndex',                      // 11
       '_dropIndex', '_createCappedCollection'],                                             // 12
      function (m) {                                                                         // 13
        ret[m] = _.bind(self.mongo[m], self.mongo, name);                                    // 14
      });                                                                                    // 15
    return ret;                                                                              // 16
  }                                                                                          // 17
});                                                                                          // 18
                                                                                             // 19
                                                                                             // 20
// Create the singleton RemoteCollectionDriver only on demand, so we                         // 21
// only require Mongo configuration if it's actually used (eg, not if                        // 22
// you're only trying to receive data from a remote DDP server.)                             // 23
MongoInternals.defaultRemoteCollectionDriver = _.once(function () {                          // 24
  // XXX kind of hacky                                                                       // 25
  var mongoUrl = (                                                                           // 26
    typeof __meteor_bootstrap__ !== 'undefined' &&                                           // 27
      Meteor._get(__meteor_bootstrap__,                                                      // 28
                  'deployConfig', 'packages', 'mongo-livedata', 'url'));                     // 29
  // XXX bad error since it could also be set directly in METEOR_DEPLOY_CONFIG               // 30
  if (! mongoUrl)                                                                            // 31
    throw new Error("MONGO_URL must be set in environment");                                 // 32
                                                                                             // 33
  return new MongoInternals.RemoteCollectionDriver(mongoUrl);                                // 34
});                                                                                          // 35
                                                                                             // 36
///////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

///////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                           //
// packages/mongo-livedata/collection.js                                                     //
//                                                                                           //
///////////////////////////////////////////////////////////////////////////////////////////////
                                                                                             //
// options.connection, if given, is a LivedataClient or LivedataServer                       // 1
// XXX presently there is no way to destroy/clean up a Collection                            // 2
                                                                                             // 3
Meteor.Collection = function (name, options) {                                               // 4
  var self = this;                                                                           // 5
  if (! (self instanceof Meteor.Collection))                                                 // 6
    throw new Error('use "new" to construct a Meteor.Collection');                           // 7
  if (options && options.methods) {                                                          // 8
    // Backwards compatibility hack with original signature (which passed                    // 9
    // "connection" directly instead of in options. (Connections must have a "methods"       // 10
    // method.)                                                                              // 11
    // XXX remove before 1.0                                                                 // 12
    options = {connection: options};                                                         // 13
  }                                                                                          // 14
  // Backwards compatibility: "connection" used to be called "manager".                      // 15
  if (options && options.manager && !options.connection) {                                   // 16
    options.connection = options.manager;                                                    // 17
  }                                                                                          // 18
  options = _.extend({                                                                       // 19
    connection: undefined,                                                                   // 20
    idGeneration: 'STRING',                                                                  // 21
    transform: null,                                                                         // 22
    _driver: undefined,                                                                      // 23
    _preventAutopublish: false                                                               // 24
  }, options);                                                                               // 25
                                                                                             // 26
  switch (options.idGeneration) {                                                            // 27
  case 'MONGO':                                                                              // 28
    self._makeNewID = function () {                                                          // 29
      return new Meteor.Collection.ObjectID();                                               // 30
    };                                                                                       // 31
    break;                                                                                   // 32
  case 'STRING':                                                                             // 33
  default:                                                                                   // 34
    self._makeNewID = function () {                                                          // 35
      return Random.id();                                                                    // 36
    };                                                                                       // 37
    break;                                                                                   // 38
  }                                                                                          // 39
                                                                                             // 40
  if (options.transform)                                                                     // 41
    self._transform = Deps._makeNonreactive(options.transform);                              // 42
  else                                                                                       // 43
    self._transform = null;                                                                  // 44
                                                                                             // 45
  if (!name && (name !== null)) {                                                            // 46
    Meteor._debug("Warning: creating anonymous collection. It will not be " +                // 47
                  "saved or synchronized over the network. (Pass null for " +                // 48
                  "the collection name to turn off this warning.)");                         // 49
  }                                                                                          // 50
                                                                                             // 51
  if (! name || options.connection === null)                                                 // 52
    // note: nameless collections never have a connection                                    // 53
    self._connection = null;                                                                 // 54
  else if (options.connection)                                                               // 55
    self._connection = options.connection;                                                   // 56
  else if (Meteor.isClient)                                                                  // 57
    self._connection = Meteor.connection;                                                    // 58
  else                                                                                       // 59
    self._connection = Meteor.server;                                                        // 60
                                                                                             // 61
  if (!options._driver) {                                                                    // 62
    if (name && self._connection === Meteor.server &&                                        // 63
        typeof MongoInternals !== "undefined" &&                                             // 64
        MongoInternals.defaultRemoteCollectionDriver) {                                      // 65
      options._driver = MongoInternals.defaultRemoteCollectionDriver();                      // 66
    } else {                                                                                 // 67
      options._driver = LocalCollectionDriver;                                               // 68
    }                                                                                        // 69
  }                                                                                          // 70
                                                                                             // 71
  self._collection = options._driver.open(name, self._connection);                           // 72
  self._name = name;                                                                         // 73
                                                                                             // 74
  if (self._connection && self._connection.registerStore) {                                  // 75
    // OK, we're going to be a slave, replicating some remote                                // 76
    // database, except possibly with some temporary divergence while                        // 77
    // we have unacknowledged RPC's.                                                         // 78
    var ok = self._connection.registerStore(name, {                                          // 79
      // Called at the beginning of a batch of updates. batchSize is the number              // 80
      // of update calls to expect.                                                          // 81
      //                                                                                     // 82
      // XXX This interface is pretty janky. reset probably ought to go back to              // 83
      // being its own function, and callers shouldn't have to calculate                     // 84
      // batchSize. The optimization of not calling pause/remove should be                   // 85
      // delayed until later: the first call to update() should buffer its                   // 86
      // message, and then we can either directly apply it at endUpdate time if              // 87
      // it was the only update, or do pauseObservers/apply/apply at the next                // 88
      // update() if there's another one.                                                    // 89
      beginUpdate: function (batchSize, reset) {                                             // 90
        // pause observers so users don't see flicker when updating several                  // 91
        // objects at once (including the post-reconnect reset-and-reapply                   // 92
        // stage), and so that a re-sorting of a query can take advantage of the             // 93
        // full _diffQuery moved calculation instead of applying change one at a             // 94
        // time.                                                                             // 95
        if (batchSize > 1 || reset)                                                          // 96
          self._collection.pauseObservers();                                                 // 97
                                                                                             // 98
        if (reset)                                                                           // 99
          self._collection.remove({});                                                       // 100
      },                                                                                     // 101
                                                                                             // 102
      // Apply an update.                                                                    // 103
      // XXX better specify this interface (not in terms of a wire message)?                 // 104
      update: function (msg) {                                                               // 105
        var mongoId = LocalCollection._idParse(msg.id);                                      // 106
        var doc = self._collection.findOne(mongoId);                                         // 107
                                                                                             // 108
        // Is this a "replace the whole doc" message coming from the quiescence              // 109
        // of method writes to an object? (Note that 'undefined' is a valid                  // 110
        // value meaning "remove it".)                                                       // 111
        if (msg.msg === 'replace') {                                                         // 112
          var replace = msg.replace;                                                         // 113
          if (!replace) {                                                                    // 114
            if (doc)                                                                         // 115
              self._collection.remove(mongoId);                                              // 116
          } else if (!doc) {                                                                 // 117
            self._collection.insert(replace);                                                // 118
          } else {                                                                           // 119
            // XXX check that replace has no $ ops                                           // 120
            self._collection.update(mongoId, replace);                                       // 121
          }                                                                                  // 122
          return;                                                                            // 123
        } else if (msg.msg === 'added') {                                                    // 124
          if (doc) {                                                                         // 125
            throw new Error("Expected not to find a document already present for an add");   // 126
          }                                                                                  // 127
          self._collection.insert(_.extend({_id: mongoId}, msg.fields));                     // 128
        } else if (msg.msg === 'removed') {                                                  // 129
          if (!doc)                                                                          // 130
            throw new Error("Expected to find a document already present for removed");      // 131
          self._collection.remove(mongoId);                                                  // 132
        } else if (msg.msg === 'changed') {                                                  // 133
          if (!doc)                                                                          // 134
            throw new Error("Expected to find a document to change");                        // 135
          if (!_.isEmpty(msg.fields)) {                                                      // 136
            var modifier = {};                                                               // 137
            _.each(msg.fields, function (value, key) {                                       // 138
              if (value === undefined) {                                                     // 139
                if (!modifier.$unset)                                                        // 140
                  modifier.$unset = {};                                                      // 141
                modifier.$unset[key] = 1;                                                    // 142
              } else {                                                                       // 143
                if (!modifier.$set)                                                          // 144
                  modifier.$set = {};                                                        // 145
                modifier.$set[key] = value;                                                  // 146
              }                                                                              // 147
            });                                                                              // 148
            self._collection.update(mongoId, modifier);                                      // 149
          }                                                                                  // 150
        } else {                                                                             // 151
          throw new Error("I don't know how to deal with this message");                     // 152
        }                                                                                    // 153
                                                                                             // 154
      },                                                                                     // 155
                                                                                             // 156
      // Called at the end of a batch of updates.                                            // 157
      endUpdate: function () {                                                               // 158
        self._collection.resumeObservers();                                                  // 159
      },                                                                                     // 160
                                                                                             // 161
      // Called around method stub invocations to capture the original versions              // 162
      // of modified documents.                                                              // 163
      saveOriginals: function () {                                                           // 164
        self._collection.saveOriginals();                                                    // 165
      },                                                                                     // 166
      retrieveOriginals: function () {                                                       // 167
        return self._collection.retrieveOriginals();                                         // 168
      }                                                                                      // 169
    });                                                                                      // 170
                                                                                             // 171
    if (!ok)                                                                                 // 172
      throw new Error("There is already a collection named '" + name + "'");                 // 173
  }                                                                                          // 174
                                                                                             // 175
  self._defineMutationMethods();                                                             // 176
                                                                                             // 177
  // autopublish                                                                             // 178
  if (Package.autopublish && !options._preventAutopublish && self._connection                // 179
      && self._connection.publish) {                                                         // 180
    self._connection.publish(null, function () {                                             // 181
      return self.find();                                                                    // 182
    }, {is_auto: true});                                                                     // 183
  }                                                                                          // 184
};                                                                                           // 185
                                                                                             // 186
///                                                                                          // 187
/// Main collection API                                                                      // 188
///                                                                                          // 189
                                                                                             // 190
                                                                                             // 191
_.extend(Meteor.Collection.prototype, {                                                      // 192
                                                                                             // 193
  _getFindSelector: function (args) {                                                        // 194
    if (args.length == 0)                                                                    // 195
      return {};                                                                             // 196
    else                                                                                     // 197
      return args[0];                                                                        // 198
  },                                                                                         // 199
                                                                                             // 200
  _getFindOptions: function (args) {                                                         // 201
    var self = this;                                                                         // 202
    if (args.length < 2) {                                                                   // 203
      return { transform: self._transform };                                                 // 204
    } else {                                                                                 // 205
      return _.extend({                                                                      // 206
        transform: self._transform                                                           // 207
      }, args[1]);                                                                           // 208
    }                                                                                        // 209
  },                                                                                         // 210
                                                                                             // 211
  find: function (/* selector, options */) {                                                 // 212
    // Collection.find() (return all docs) behaves differently                               // 213
    // from Collection.find(undefined) (return 0 docs).  so be                               // 214
    // careful about the length of arguments.                                                // 215
    var self = this;                                                                         // 216
    var argArray = _.toArray(arguments);                                                     // 217
    return self._collection.find(self._getFindSelector(argArray),                            // 218
                                 self._getFindOptions(argArray));                            // 219
  },                                                                                         // 220
                                                                                             // 221
  findOne: function (/* selector, options */) {                                              // 222
    var self = this;                                                                         // 223
    var argArray = _.toArray(arguments);                                                     // 224
    return self._collection.findOne(self._getFindSelector(argArray),                         // 225
                                    self._getFindOptions(argArray));                         // 226
  }                                                                                          // 227
                                                                                             // 228
});                                                                                          // 229
                                                                                             // 230
Meteor.Collection._publishCursor = function (cursor, sub, collection) {                      // 231
  var observeHandle = cursor.observeChanges({                                                // 232
    added: function (id, fields) {                                                           // 233
      sub.added(collection, id, fields);                                                     // 234
    },                                                                                       // 235
    changed: function (id, fields) {                                                         // 236
      sub.changed(collection, id, fields);                                                   // 237
    },                                                                                       // 238
    removed: function (id) {                                                                 // 239
      sub.removed(collection, id);                                                           // 240
    }                                                                                        // 241
  });                                                                                        // 242
                                                                                             // 243
  // We don't call sub.ready() here: it gets called in livedata_server, after                // 244
  // possibly calling _publishCursor on multiple returned cursors.                           // 245
                                                                                             // 246
  // register stop callback (expects lambda w/ no args).                                     // 247
  sub.onStop(function () {observeHandle.stop();});                                           // 248
};                                                                                           // 249
                                                                                             // 250
// protect against dangerous selectors.  falsey and {_id: falsey} are both                   // 251
// likely programmer error, and not what you want, particularly for destructive              // 252
// operations.  JS regexps don't serialize over DDP but can be trivially                     // 253
// replaced by $regex.                                                                       // 254
Meteor.Collection._rewriteSelector = function (selector) {                                   // 255
  // shorthand -- scalars match _id                                                          // 256
  if (LocalCollection._selectorIsId(selector))                                               // 257
    selector = {_id: selector};                                                              // 258
                                                                                             // 259
  if (!selector || (('_id' in selector) && !selector._id))                                   // 260
    // can't match anything                                                                  // 261
    return {_id: Random.id()};                                                               // 262
                                                                                             // 263
  var ret = {};                                                                              // 264
  _.each(selector, function (value, key) {                                                   // 265
    // Mongo supports both {field: /foo/} and {field: {$regex: /foo/}}                       // 266
    if (value instanceof RegExp) {                                                           // 267
      ret[key] = convertRegexpToMongoSelector(value);                                        // 268
    } else if (value && value.$regex instanceof RegExp) {                                    // 269
      ret[key] = convertRegexpToMongoSelector(value.$regex);                                 // 270
      // if value is {$regex: /foo/, $options: ...} then $options                            // 271
      // override the ones set on $regex.                                                    // 272
      if (value.$options !== undefined)                                                      // 273
        ret[key].$options = value.$options;                                                  // 274
    }                                                                                        // 275
    else if (_.contains(['$or','$and','$nor'], key)) {                                       // 276
      // Translate lower levels of $and/$or/$nor                                             // 277
      ret[key] = _.map(value, function (v) {                                                 // 278
        return Meteor.Collection._rewriteSelector(v);                                        // 279
      });                                                                                    // 280
    }                                                                                        // 281
    else {                                                                                   // 282
      ret[key] = value;                                                                      // 283
    }                                                                                        // 284
  });                                                                                        // 285
  return ret;                                                                                // 286
};                                                                                           // 287
                                                                                             // 288
// convert a JS RegExp object to a Mongo {$regex: ..., $options: ...}                        // 289
// selector                                                                                  // 290
var convertRegexpToMongoSelector = function (regexp) {                                       // 291
  check(regexp, RegExp); // safety belt                                                      // 292
                                                                                             // 293
  var selector = {$regex: regexp.source};                                                    // 294
  var regexOptions = '';                                                                     // 295
  // JS RegExp objects support 'i', 'm', and 'g'. Mongo regex $options                       // 296
  // support 'i', 'm', 'x', and 's'. So we support 'i' and 'm' here.                         // 297
  if (regexp.ignoreCase)                                                                     // 298
    regexOptions += 'i';                                                                     // 299
  if (regexp.multiline)                                                                      // 300
    regexOptions += 'm';                                                                     // 301
  if (regexOptions)                                                                          // 302
    selector.$options = regexOptions;                                                        // 303
                                                                                             // 304
  return selector;                                                                           // 305
};                                                                                           // 306
                                                                                             // 307
var throwIfSelectorIsNotId = function (selector, methodName) {                               // 308
  if (!LocalCollection._selectorIsIdPerhapsAsObject(selector)) {                             // 309
    throw new Meteor.Error(                                                                  // 310
      403, "Not permitted. Untrusted code may only " + methodName +                          // 311
        " documents by ID.");                                                                // 312
  }                                                                                          // 313
};                                                                                           // 314
                                                                                             // 315
// 'insert' immediately returns the inserted document's new _id.  The                        // 316
// others return nothing.                                                                    // 317
//                                                                                           // 318
// Otherwise, the semantics are exactly like other methods: they take                        // 319
// a callback as an optional last argument; if no callback is                                // 320
// provided, they block until the operation is complete, and throw an                        // 321
// exception if it fails; if a callback is provided, then they don't                         // 322
// necessarily block, and they call the callback when they finish with                       // 323
// error and result arguments.  (The insert method provides the                              // 324
// document ID as its result; update and remove don't provide a result.)                     // 325
//                                                                                           // 326
// On the client, blocking is impossible, so if a callback                                   // 327
// isn't provided, they just return immediately and any error                                // 328
// information is lost.                                                                      // 329
//                                                                                           // 330
// There's one more tweak. On the client, if you don't provide a                             // 331
// callback, then if there is an error, a message will be logged with                        // 332
// Meteor._debug.                                                                            // 333
//                                                                                           // 334
// The intent (though this is actually determined by the underlying                          // 335
// drivers) is that the operations should be done synchronously, not                         // 336
// generating their result until the database has acknowledged                               // 337
// them. In the future maybe we should provide a flag to turn this                           // 338
// off.                                                                                      // 339
_.each(["insert", "update", "remove"], function (name) {                                     // 340
  Meteor.Collection.prototype[name] = function (/* arguments */) {                           // 341
    var self = this;                                                                         // 342
    var args = _.toArray(arguments);                                                         // 343
    var callback;                                                                            // 344
    var ret;                                                                                 // 345
                                                                                             // 346
    if (args.length && args[args.length - 1] instanceof Function)                            // 347
      callback = args.pop();                                                                 // 348
                                                                                             // 349
    if (Meteor.isClient && !callback) {                                                      // 350
      // Client can't block, so it can't report errors by exception,                         // 351
      // only by callback. If they forget the callback, give them a                          // 352
      // default one that logs the error, so they aren't totally                             // 353
      // baffled if their writes don't work because their database is                        // 354
      // down.                                                                               // 355
      callback = function (err) {                                                            // 356
        if (err)                                                                             // 357
          Meteor._debug(name + " failed: " + (err.reason || err.stack));                     // 358
      };                                                                                     // 359
    }                                                                                        // 360
                                                                                             // 361
    if (name === "insert") {                                                                 // 362
      if (!args.length)                                                                      // 363
        throw new Error("insert requires an argument");                                      // 364
      // shallow-copy the document and generate an ID                                        // 365
      args[0] = _.extend({}, args[0]);                                                       // 366
      if ('_id' in args[0]) {                                                                // 367
        ret = args[0]._id;                                                                   // 368
        if (!(typeof ret === 'string'                                                        // 369
              || ret instanceof Meteor.Collection.ObjectID))                                 // 370
          throw new Error("Meteor requires document _id fields to be strings or ObjectIDs"); // 371
      } else {                                                                               // 372
        ret = args[0]._id = self._makeNewID();                                               // 373
      }                                                                                      // 374
    } else {                                                                                 // 375
      args[0] = Meteor.Collection._rewriteSelector(args[0]);                                 // 376
    }                                                                                        // 377
                                                                                             // 378
    var wrappedCallback;                                                                     // 379
    if (callback) {                                                                          // 380
      wrappedCallback = function (error, result) {                                           // 381
        callback(error, !error && ret);                                                      // 382
      };                                                                                     // 383
    }                                                                                        // 384
                                                                                             // 385
    if (self._connection && self._connection !== Meteor.server) {                            // 386
      // just remote to another endpoint, propagate return value or                          // 387
      // exception.                                                                          // 388
                                                                                             // 389
      var enclosing = DDP._CurrentInvocation.get();                                          // 390
      var alreadyInSimulation = enclosing && enclosing.isSimulation;                         // 391
      if (!alreadyInSimulation && name !== "insert") {                                       // 392
        // If we're about to actually send an RPC, we should throw an error if               // 393
        // this is a non-ID selector, because the mutation methods only allow                // 394
        // single-ID selectors. (If we don't throw here, we'll see flicker.)                 // 395
        throwIfSelectorIsNotId(args[0], name);                                               // 396
      }                                                                                      // 397
                                                                                             // 398
      self._connection.apply(self._prefix + name, args, wrappedCallback);                    // 399
                                                                                             // 400
    } else {                                                                                 // 401
      // it's my collection.  descend into the collection object                             // 402
      // and propagate any exception.                                                        // 403
      args.push(wrappedCallback);                                                            // 404
      try {                                                                                  // 405
        self._collection[name].apply(self._collection, args);                                // 406
      } catch (e) {                                                                          // 407
        if (callback) {                                                                      // 408
          callback(e);                                                                       // 409
          return null;                                                                       // 410
        }                                                                                    // 411
        throw e;                                                                             // 412
      }                                                                                      // 413
    }                                                                                        // 414
                                                                                             // 415
    // both sync and async, unless we threw an exception, return ret                         // 416
    // (new document ID for insert, undefined otherwise).                                    // 417
    return ret;                                                                              // 418
  };                                                                                         // 419
});                                                                                          // 420
                                                                                             // 421
// We'll actually design an index API later. For now, we just pass through to                // 422
// Mongo's, but make it synchronous.                                                         // 423
Meteor.Collection.prototype._ensureIndex = function (index, options) {                       // 424
  var self = this;                                                                           // 425
  if (!self._collection._ensureIndex)                                                        // 426
    throw new Error("Can only call _ensureIndex on server collections");                     // 427
  self._collection._ensureIndex(index, options);                                             // 428
};                                                                                           // 429
Meteor.Collection.prototype._dropIndex = function (index) {                                  // 430
  var self = this;                                                                           // 431
  if (!self._collection._dropIndex)                                                          // 432
    throw new Error("Can only call _dropIndex on server collections");                       // 433
  self._collection._dropIndex(index);                                                        // 434
};                                                                                           // 435
Meteor.Collection.prototype._createCappedCollection = function (byteSize) {                  // 436
  var self = this;                                                                           // 437
  if (!self._collection._createCappedCollection)                                             // 438
    throw new Error("Can only call _createCappedCollection on server collections");          // 439
  self._collection._createCappedCollection(byteSize);                                        // 440
};                                                                                           // 441
                                                                                             // 442
Meteor.Collection.ObjectID = LocalCollection._ObjectID;                                      // 443
                                                                                             // 444
///                                                                                          // 445
/// Remote methods and access control.                                                       // 446
///                                                                                          // 447
                                                                                             // 448
// Restrict default mutators on collection. allow() and deny() take the                      // 449
// same options:                                                                             // 450
//                                                                                           // 451
// options.insert {Function(userId, doc)}                                                    // 452
//   return true to allow/deny adding this document                                          // 453
//                                                                                           // 454
// options.update {Function(userId, docs, fields, modifier)}                                 // 455
//   return true to allow/deny updating these documents.                                     // 456
//   `fields` is passed as an array of fields that are to be modified                        // 457
//                                                                                           // 458
// options.remove {Function(userId, docs)}                                                   // 459
//   return true to allow/deny removing these documents                                      // 460
//                                                                                           // 461
// options.fetch {Array}                                                                     // 462
//   Fields to fetch for these validators. If any call to allow or deny                      // 463
//   does not have this option then all fields are loaded.                                   // 464
//                                                                                           // 465
// allow and deny can be called multiple times. The validators are                           // 466
// evaluated as follows:                                                                     // 467
// - If neither deny() nor allow() has been called on the collection,                        // 468
//   then the request is allowed if and only if the "insecure" smart                         // 469
//   package is in use.                                                                      // 470
// - Otherwise, if any deny() function returns true, the request is denied.                  // 471
// - Otherwise, if any allow() function returns true, the request is allowed.                // 472
// - Otherwise, the request is denied.                                                       // 473
//                                                                                           // 474
// Meteor may call your deny() and allow() functions in any order, and may not               // 475
// call all of them if it is able to make a decision without calling them all                // 476
// (so don't include side effects).                                                          // 477
                                                                                             // 478
(function () {                                                                               // 479
  var addValidator = function(allowOrDeny, options) {                                        // 480
    // validate keys                                                                         // 481
    var VALID_KEYS = ['insert', 'update', 'remove', 'fetch', 'transform'];                   // 482
    _.each(_.keys(options), function (key) {                                                 // 483
      if (!_.contains(VALID_KEYS, key))                                                      // 484
        throw new Error(allowOrDeny + ": Invalid key: " + key);                              // 485
    });                                                                                      // 486
                                                                                             // 487
    var self = this;                                                                         // 488
    self._restricted = true;                                                                 // 489
                                                                                             // 490
    _.each(['insert', 'update', 'remove'], function (name) {                                 // 491
      if (options[name]) {                                                                   // 492
        if (!(options[name] instanceof Function)) {                                          // 493
          throw new Error(allowOrDeny + ": Value for `" + name + "` must be a function");    // 494
        }                                                                                    // 495
        if (self._transform)                                                                 // 496
          options[name].transform = self._transform;                                         // 497
        if (options.transform)                                                               // 498
          options[name].transform = Deps._makeNonreactive(options.transform);                // 499
        self._validators[name][allowOrDeny].push(options[name]);                             // 500
      }                                                                                      // 501
    });                                                                                      // 502
                                                                                             // 503
    // Only update the fetch fields if we're passed things that affect                       // 504
    // fetching. This way allow({}) and allow({insert: f}) don't result in                   // 505
    // setting fetchAllFields                                                                // 506
    if (options.update || options.remove || options.fetch) {                                 // 507
      if (options.fetch && !(options.fetch instanceof Array)) {                              // 508
        throw new Error(allowOrDeny + ": Value for `fetch` must be an array");               // 509
      }                                                                                      // 510
      self._updateFetch(options.fetch);                                                      // 511
    }                                                                                        // 512
  };                                                                                         // 513
                                                                                             // 514
  Meteor.Collection.prototype.allow = function(options) {                                    // 515
    addValidator.call(this, 'allow', options);                                               // 516
  };                                                                                         // 517
  Meteor.Collection.prototype.deny = function(options) {                                     // 518
    addValidator.call(this, 'deny', options);                                                // 519
  };                                                                                         // 520
})();                                                                                        // 521
                                                                                             // 522
                                                                                             // 523
Meteor.Collection.prototype._defineMutationMethods = function() {                            // 524
  var self = this;                                                                           // 525
                                                                                             // 526
  // set to true once we call any allow or deny methods. If true, use                        // 527
  // allow/deny semantics. If false, use insecure mode semantics.                            // 528
  self._restricted = false;                                                                  // 529
                                                                                             // 530
  // Insecure mode (default to allowing writes). Defaults to 'undefined' which               // 531
  // means insecure iff the insecure package is loaded. This property can be                 // 532
  // overriden by tests or packages wishing to change insecure mode behavior of              // 533
  // their collections.                                                                      // 534
  self._insecure = undefined;                                                                // 535
                                                                                             // 536
  self._validators = {                                                                       // 537
    insert: {allow: [], deny: []},                                                           // 538
    update: {allow: [], deny: []},                                                           // 539
    remove: {allow: [], deny: []},                                                           // 540
    fetch: [],                                                                               // 541
    fetchAllFields: false                                                                    // 542
  };                                                                                         // 543
                                                                                             // 544
  if (!self._name)                                                                           // 545
    return; // anonymous collection                                                          // 546
                                                                                             // 547
  // XXX Think about method namespacing. Maybe methods should be                             // 548
  // "Meteor:Mongo:insert/NAME"?                                                             // 549
  self._prefix = '/' + self._name + '/';                                                     // 550
                                                                                             // 551
  // mutation methods                                                                        // 552
  if (self._connection) {                                                                    // 553
    var m = {};                                                                              // 554
                                                                                             // 555
    _.each(['insert', 'update', 'remove'], function (method) {                               // 556
      m[self._prefix + method] = function (/* ... */) {                                      // 557
        // All the methods do their own validation, instead of using check().                // 558
        check(arguments, [Match.Any]);                                                       // 559
        try {                                                                                // 560
          if (this.isSimulation) {                                                           // 561
                                                                                             // 562
            // In a client simulation, you can do any mutation (even with a                  // 563
            // complex selector).                                                            // 564
            self._collection[method].apply(                                                  // 565
              self._collection, _.toArray(arguments));                                       // 566
            return;                                                                          // 567
          }                                                                                  // 568
                                                                                             // 569
          // This is the server receiving a method call from the client. We                  // 570
          // don't allow arbitrary selectors in mutations from the client: only              // 571
          // single-ID selectors.                                                            // 572
          if (method !== 'insert')                                                           // 573
            throwIfSelectorIsNotId(arguments[0], method);                                    // 574
                                                                                             // 575
          if (self._restricted) {                                                            // 576
            // short circuit if there is no way it will pass.                                // 577
            if (self._validators[method].allow.length === 0) {                               // 578
              throw new Meteor.Error(                                                        // 579
                403, "Access denied. No allow validators set on restricted " +               // 580
                  "collection for method '" + method + "'.");                                // 581
            }                                                                                // 582
                                                                                             // 583
            var validatedMethodName =                                                        // 584
                  '_validated' + method.charAt(0).toUpperCase() + method.slice(1);           // 585
            var argsWithUserId = [this.userId].concat(_.toArray(arguments));                 // 586
            self[validatedMethodName].apply(self, argsWithUserId);                           // 587
          } else if (self._isInsecure()) {                                                   // 588
            // In insecure mode, allow any mutation (with a simple selector).                // 589
            self._collection[method].apply(self._collection,                                 // 590
                                           _.toArray(arguments));                            // 591
          } else {                                                                           // 592
            // In secure mode, if we haven't called allow or deny, then nothing              // 593
            // is permitted.                                                                 // 594
            throw new Meteor.Error(403, "Access denied");                                    // 595
          }                                                                                  // 596
        } catch (e) {                                                                        // 597
          if (e.name === 'MongoError' || e.name === 'MinimongoError') {                      // 598
            throw new Meteor.Error(409, e.toString());                                       // 599
          } else {                                                                           // 600
            throw e;                                                                         // 601
          }                                                                                  // 602
        }                                                                                    // 603
      };                                                                                     // 604
    });                                                                                      // 605
    // Minimongo on the server gets no stubs; instead, by default                            // 606
    // it wait()s until its result is ready, yielding.                                       // 607
    // This matches the behavior of macromongo on the server better.                         // 608
    if (Meteor.isClient || self._connection === Meteor.server)                               // 609
      self._connection.methods(m);                                                           // 610
  }                                                                                          // 611
};                                                                                           // 612
                                                                                             // 613
                                                                                             // 614
Meteor.Collection.prototype._updateFetch = function (fields) {                               // 615
  var self = this;                                                                           // 616
                                                                                             // 617
  if (!self._validators.fetchAllFields) {                                                    // 618
    if (fields) {                                                                            // 619
      self._validators.fetch = _.union(self._validators.fetch, fields);                      // 620
    } else {                                                                                 // 621
      self._validators.fetchAllFields = true;                                                // 622
      // clear fetch just to make sure we don't accidentally read it                         // 623
      self._validators.fetch = null;                                                         // 624
    }                                                                                        // 625
  }                                                                                          // 626
};                                                                                           // 627
                                                                                             // 628
Meteor.Collection.prototype._isInsecure = function () {                                      // 629
  var self = this;                                                                           // 630
  if (self._insecure === undefined)                                                          // 631
    return !!Package.insecure;                                                               // 632
  return self._insecure;                                                                     // 633
};                                                                                           // 634
                                                                                             // 635
var docToValidate = function (validator, doc) {                                              // 636
  var ret = doc;                                                                             // 637
  if (validator.transform)                                                                   // 638
    ret = validator.transform(EJSON.clone(doc));                                             // 639
  return ret;                                                                                // 640
};                                                                                           // 641
                                                                                             // 642
Meteor.Collection.prototype._validatedInsert = function(userId, doc) {                       // 643
  var self = this;                                                                           // 644
                                                                                             // 645
  // call user validators.                                                                   // 646
  // Any deny returns true means denied.                                                     // 647
  if (_.any(self._validators.insert.deny, function(validator) {                              // 648
    return validator(userId, docToValidate(validator, doc));                                 // 649
  })) {                                                                                      // 650
    throw new Meteor.Error(403, "Access denied");                                            // 651
  }                                                                                          // 652
  // Any allow returns true means proceed. Throw error if they all fail.                     // 653
  if (_.all(self._validators.insert.allow, function(validator) {                             // 654
    return !validator(userId, docToValidate(validator, doc));                                // 655
  })) {                                                                                      // 656
    throw new Meteor.Error(403, "Access denied");                                            // 657
  }                                                                                          // 658
                                                                                             // 659
  self._collection.insert.call(self._collection, doc);                                       // 660
};                                                                                           // 661
                                                                                             // 662
var transformDoc = function (validator, doc) {                                               // 663
  if (validator.transform)                                                                   // 664
    return validator.transform(doc);                                                         // 665
  return doc;                                                                                // 666
};                                                                                           // 667
                                                                                             // 668
// Simulate a mongo `update` operation while validating that the access                      // 669
// control rules set by calls to `allow/deny` are satisfied. If all                          // 670
// pass, rewrite the mongo operation to use $in to set the list of                           // 671
// document ids to change ##ValidatedChange                                                  // 672
Meteor.Collection.prototype._validatedUpdate = function(                                     // 673
    userId, selector, mutator, options) {                                                    // 674
  var self = this;                                                                           // 675
                                                                                             // 676
  if (!LocalCollection._selectorIsIdPerhapsAsObject(selector))                               // 677
    throw new Error("validated update should be of a single ID");                            // 678
                                                                                             // 679
  // compute modified fields                                                                 // 680
  var fields = [];                                                                           // 681
  _.each(mutator, function (params, op) {                                                    // 682
    if (op.charAt(0) !== '$') {                                                              // 683
      throw new Meteor.Error(                                                                // 684
        403, "Access denied. In a restricted collection you can only update documents, not replace them. Use a Mongo update operator, such as '$set'.");
    } else if (!_.has(ALLOWED_UPDATE_OPERATIONS, op)) {                                      // 686
      throw new Meteor.Error(                                                                // 687
        403, "Access denied. Operator " + op + " not allowed in a restricted collection.");  // 688
    } else {                                                                                 // 689
      _.each(_.keys(params), function (field) {                                              // 690
        // treat dotted fields as if they are replacing their                                // 691
        // top-level part                                                                    // 692
        if (field.indexOf('.') !== -1)                                                       // 693
          field = field.substring(0, field.indexOf('.'));                                    // 694
                                                                                             // 695
        // record the field we are trying to change                                          // 696
        if (!_.contains(fields, field))                                                      // 697
          fields.push(field);                                                                // 698
      });                                                                                    // 699
    }                                                                                        // 700
  });                                                                                        // 701
                                                                                             // 702
  var findOptions = {transform: null};                                                       // 703
  if (!self._validators.fetchAllFields) {                                                    // 704
    findOptions.fields = {};                                                                 // 705
    _.each(self._validators.fetch, function(fieldName) {                                     // 706
      findOptions.fields[fieldName] = 1;                                                     // 707
    });                                                                                      // 708
  }                                                                                          // 709
                                                                                             // 710
  var doc = self._collection.findOne(selector, findOptions);                                 // 711
  if (!doc)  // none satisfied!                                                              // 712
    return;                                                                                  // 713
                                                                                             // 714
  var factoriedDoc;                                                                          // 715
                                                                                             // 716
  // call user validators.                                                                   // 717
  // Any deny returns true means denied.                                                     // 718
  if (_.any(self._validators.update.deny, function(validator) {                              // 719
    if (!factoriedDoc)                                                                       // 720
      factoriedDoc = transformDoc(validator, doc);                                           // 721
    return validator(userId,                                                                 // 722
                     factoriedDoc,                                                           // 723
                     fields,                                                                 // 724
                     mutator);                                                               // 725
  })) {                                                                                      // 726
    throw new Meteor.Error(403, "Access denied");                                            // 727
  }                                                                                          // 728
  // Any allow returns true means proceed. Throw error if they all fail.                     // 729
  if (_.all(self._validators.update.allow, function(validator) {                             // 730
    if (!factoriedDoc)                                                                       // 731
      factoriedDoc = transformDoc(validator, doc);                                           // 732
    return !validator(userId,                                                                // 733
                      factoriedDoc,                                                          // 734
                      fields,                                                                // 735
                      mutator);                                                              // 736
  })) {                                                                                      // 737
    throw new Meteor.Error(403, "Access denied");                                            // 738
  }                                                                                          // 739
                                                                                             // 740
  // Back when we supported arbitrary client-provided selectors, we actually                 // 741
  // rewrote the selector to include an _id clause before passing to Mongo to                // 742
  // avoid races, but since selector is guaranteed to already just be an ID, we              // 743
  // don't have to any more.                                                                 // 744
                                                                                             // 745
  self._collection.update.call(                                                              // 746
    self._collection, selector, mutator, options);                                           // 747
};                                                                                           // 748
                                                                                             // 749
// Only allow these operations in validated updates. Specifically                            // 750
// whitelist operations, rather than blacklist, so new complex                               // 751
// operations that are added aren't automatically allowed. A complex                         // 752
// operation is one that does more than just modify its target                               // 753
// field. For now this contains all update operations except '$rename'.                      // 754
// http://docs.mongodb.org/manual/reference/operators/#update                                // 755
var ALLOWED_UPDATE_OPERATIONS = {                                                            // 756
  $inc:1, $set:1, $unset:1, $addToSet:1, $pop:1, $pullAll:1, $pull:1,                        // 757
  $pushAll:1, $push:1, $bit:1                                                                // 758
};                                                                                           // 759
                                                                                             // 760
// Simulate a mongo `remove` operation while validating access control                       // 761
// rules. See #ValidatedChange                                                               // 762
Meteor.Collection.prototype._validatedRemove = function(userId, selector) {                  // 763
  var self = this;                                                                           // 764
                                                                                             // 765
  var findOptions = {transform: null};                                                       // 766
  if (!self._validators.fetchAllFields) {                                                    // 767
    findOptions.fields = {};                                                                 // 768
    _.each(self._validators.fetch, function(fieldName) {                                     // 769
      findOptions.fields[fieldName] = 1;                                                     // 770
    });                                                                                      // 771
  }                                                                                          // 772
                                                                                             // 773
  var doc = self._collection.findOne(selector, findOptions);                                 // 774
  if (!doc)                                                                                  // 775
    return;                                                                                  // 776
                                                                                             // 777
  // call user validators.                                                                   // 778
  // Any deny returns true means denied.                                                     // 779
  if (_.any(self._validators.remove.deny, function(validator) {                              // 780
    return validator(userId, transformDoc(validator, doc));                                  // 781
  })) {                                                                                      // 782
    throw new Meteor.Error(403, "Access denied");                                            // 783
  }                                                                                          // 784
  // Any allow returns true means proceed. Throw error if they all fail.                     // 785
  if (_.all(self._validators.remove.allow, function(validator) {                             // 786
    return !validator(userId, transformDoc(validator, doc));                                 // 787
  })) {                                                                                      // 788
    throw new Meteor.Error(403, "Access denied");                                            // 789
  }                                                                                          // 790
                                                                                             // 791
  // Back when we supported arbitrary client-provided selectors, we actually                 // 792
  // rewrote the selector to {_id: {$in: [ids that we found]}} before passing to             // 793
  // Mongo to avoid races, but since selector is guaranteed to already just be               // 794
  // an ID, we don't have to any more.                                                       // 795
                                                                                             // 796
  self._collection.remove.call(self._collection, selector);                                  // 797
};                                                                                           // 798
                                                                                             // 799
///////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package['mongo-livedata'] = {
  MongoInternals: MongoInternals
};

})();
