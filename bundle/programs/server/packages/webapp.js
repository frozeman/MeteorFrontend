(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var Log = Package.logging.Log;
var _ = Package.underscore._;
var RoutePolicy = Package.routepolicy.RoutePolicy;

/* Package-scope variables */
var WebApp, main, WebAppInternals;

(function () {

/////////////////////////////////////////////////////////////////////////////////////////
//                                                                                     //
// packages/webapp/webapp_server.js                                                    //
//                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////
                                                                                       //
////////// Requires //////////                                                         // 1
                                                                                       // 2
var fs = Npm.require("fs");                                                            // 3
var http = Npm.require("http");                                                        // 4
var os = Npm.require("os");                                                            // 5
var path = Npm.require("path");                                                        // 6
var url = Npm.require("url");                                                          // 7
var crypto = Npm.require("crypto");                                                    // 8
                                                                                       // 9
var connect = Npm.require('connect');                                                  // 10
var optimist = Npm.require('optimist');                                                // 11
var useragent = Npm.require('useragent');                                              // 12
var send = Npm.require('send');                                                        // 13
                                                                                       // 14
WebApp = {};                                                                           // 15
WebAppInternals = {};                                                                  // 16
                                                                                       // 17
var findGalaxy = _.once(function () {                                                  // 18
  if (!('GALAXY' in process.env)) {                                                    // 19
    console.log(                                                                       // 20
      "To do Meteor Galaxy operations like binding to a Galaxy " +                     // 21
        "proxy, the GALAXY environment variable must be set.");                        // 22
    process.exit(1);                                                                   // 23
  }                                                                                    // 24
                                                                                       // 25
  return DDP.connect(process.env['GALAXY']);                                           // 26
});                                                                                    // 27
                                                                                       // 28
// Keepalives so that when the outer server dies unceremoniously and                   // 29
// doesn't kill us, we quit ourselves. A little gross, but better than                 // 30
// pidfiles.                                                                           // 31
// XXX This should really be part of the boot script, not the webapp package.          // 32
//     Or we should just get rid of it, and rely on containerization.                  // 33
                                                                                       // 34
var initKeepalive = function () {                                                      // 35
  var keepaliveCount = 0;                                                              // 36
                                                                                       // 37
  process.stdin.on('data', function (data) {                                           // 38
    keepaliveCount = 0;                                                                // 39
  });                                                                                  // 40
                                                                                       // 41
  process.stdin.resume();                                                              // 42
                                                                                       // 43
  setInterval(function () {                                                            // 44
    keepaliveCount ++;                                                                 // 45
    if (keepaliveCount >= 3) {                                                         // 46
      console.log("Failed to receive keepalive! Exiting.");                            // 47
      process.exit(1);                                                                 // 48
    }                                                                                  // 49
  }, 3000);                                                                            // 50
};                                                                                     // 51
                                                                                       // 52
                                                                                       // 53
var sha1 = function (contents) {                                                       // 54
  var hash = crypto.createHash('sha1');                                                // 55
  hash.update(contents);                                                               // 56
  return hash.digest('hex');                                                           // 57
};                                                                                     // 58
                                                                                       // 59
// #BrowserIdentification                                                              // 60
//                                                                                     // 61
// We have multiple places that want to identify the browser: the                      // 62
// unsupported browser page, the appcache package, and, eventually                     // 63
// delivering browser polyfills only as needed.                                        // 64
//                                                                                     // 65
// To avoid detecting the browser in multiple places ad-hoc, we create a               // 66
// Meteor "browser" object. It uses but does not expose the npm                        // 67
// useragent module (we could choose a different mechanism to identify                 // 68
// the browser in the future if we wanted to).  The browser object                     // 69
// contains                                                                            // 70
//                                                                                     // 71
// * `name`: the name of the browser in camel case                                     // 72
// * `major`, `minor`, `patch`: integers describing the browser version                // 73
//                                                                                     // 74
// Also here is an early version of a Meteor `request` object, intended                // 75
// to be a high-level description of the request without exposing                      // 76
// details of connect's low-level `req`.  Currently it contains:                       // 77
//                                                                                     // 78
// * `browser`: browser identification object described above                          // 79
// * `url`: parsed url, including parsed query params                                  // 80
//                                                                                     // 81
// As a temporary hack there is a `categorizeRequest` function on WebApp which         // 82
// converts a connect `req` to a Meteor `request`. This can go away once smart         // 83
// packages such as appcache are being passed a `request` object directly when         // 84
// they serve content.                                                                 // 85
//                                                                                     // 86
// This allows `request` to be used uniformly: it is passed to the html                // 87
// attributes hook, and the appcache package can use it when deciding                  // 88
// whether to generate a 404 for the manifest.                                         // 89
//                                                                                     // 90
// Real routing / server side rendering will probably refactor this                    // 91
// heavily.                                                                            // 92
                                                                                       // 93
                                                                                       // 94
// e.g. "Mobile Safari" => "mobileSafari"                                              // 95
var camelCase = function (name) {                                                      // 96
  var parts = name.split(' ');                                                         // 97
  parts[0] = parts[0].toLowerCase();                                                   // 98
  for (var i = 1;  i < parts.length;  ++i) {                                           // 99
    parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].substr(1);                  // 100
  }                                                                                    // 101
  return parts.join('');                                                               // 102
};                                                                                     // 103
                                                                                       // 104
var identifyBrowser = function (req) {                                                 // 105
  var userAgent = useragent.lookup(req.headers['user-agent']);                         // 106
  return {                                                                             // 107
    name: camelCase(userAgent.family),                                                 // 108
    major: +userAgent.major,                                                           // 109
    minor: +userAgent.minor,                                                           // 110
    patch: +userAgent.patch                                                            // 111
  };                                                                                   // 112
};                                                                                     // 113
                                                                                       // 114
WebApp.categorizeRequest = function (req) {                                            // 115
  return {                                                                             // 116
    browser: identifyBrowser(req),                                                     // 117
    url: url.parse(req.url, true)                                                      // 118
  };                                                                                   // 119
};                                                                                     // 120
                                                                                       // 121
// HTML attribute hooks: functions to be called to determine any attributes to         // 122
// be added to the '<html>' tag. Each function is passed a 'request' object (see       // 123
// #BrowserIdentification) and should return a string,                                 // 124
var htmlAttributeHooks = [];                                                           // 125
var htmlAttributes = function (template, request) {                                    // 126
  var attributes = '';                                                                 // 127
  _.each(htmlAttributeHooks || [], function (hook) {                                   // 128
    var attribute = hook(request);                                                     // 129
    if (attribute !== null && attribute !== undefined && attribute !== '')             // 130
      attributes += ' ' + attribute;                                                   // 131
  });                                                                                  // 132
  return template.replace('##HTML_ATTRIBUTES##', attributes);                          // 133
};                                                                                     // 134
WebApp.addHtmlAttributeHook = function (hook) {                                        // 135
  htmlAttributeHooks.push(hook);                                                       // 136
};                                                                                     // 137
                                                                                       // 138
// Serve app HTML for this URL?                                                        // 139
var appUrl = function (url) {                                                          // 140
  if (url === '/favicon.ico' || url === '/robots.txt')                                 // 141
    return false;                                                                      // 142
                                                                                       // 143
  // NOTE: app.manifest is not a web standard like favicon.ico and                     // 144
  // robots.txt. It is a file name we have chosen to use for HTML5                     // 145
  // appcache URLs. It is included here to prevent using an appcache                   // 146
  // then removing it from poisoning an app permanently. Eventually,                   // 147
  // once we have server side routing, this won't be needed as                         // 148
  // unknown URLs with return a 404 automatically.                                     // 149
  if (url === '/app.manifest')                                                         // 150
    return false;                                                                      // 151
                                                                                       // 152
  // Avoid serving app HTML for declared routes such as /sockjs/.                      // 153
  if (RoutePolicy.classify(url))                                                       // 154
    return false;                                                                      // 155
                                                                                       // 156
  // we currently return app HTML on all URLs by default                               // 157
  return true;                                                                         // 158
};                                                                                     // 159
                                                                                       // 160
// This is used to move legacy environment variables into deployConfig, where          // 161
// other packages look for them. We probably don't want it here forever.               // 162
var copyEnvVarToDeployConfig = function (deployConfig, envVar,                         // 163
                                         packageName, configKey) {                     // 164
  if (process.env[envVar]) {                                                           // 165
    if (! deployConfig.packages[packageName])                                          // 166
      deployConfig.packages[packageName] = {};                                         // 167
    deployConfig.packages[packageName][configKey] = process.env[envVar];               // 168
  }                                                                                    // 169
};                                                                                     // 170
                                                                                       // 171
var runWebAppServer = function () {                                                    // 172
  // read the control for the client we'll be serving up                               // 173
  var clientJsonPath = path.join(__meteor_bootstrap__.serverDir,                       // 174
                                 __meteor_bootstrap__.configJson.client);              // 175
  var clientDir = path.dirname(clientJsonPath);                                        // 176
  var clientJson = JSON.parse(fs.readFileSync(clientJsonPath, 'utf8'));                // 177
                                                                                       // 178
  if (clientJson.format !== "browser-program-pre1")                                    // 179
    throw new Error("Unsupported format for client assets: " +                         // 180
                    JSON.stringify(clientJson.format));                                // 181
                                                                                       // 182
  // XXX change all this config to something more reasonable.                          // 183
  //     and move it out of webapp into a different package so you don't               // 184
  //     have weird things like mongo-livedata weak-dep'ing on webapp                  // 185
  var deployConfig =                                                                   // 186
        process.env.METEOR_DEPLOY_CONFIG                                               // 187
        ? JSON.parse(process.env.METEOR_DEPLOY_CONFIG) : {};                           // 188
  if (!deployConfig.packages)                                                          // 189
    deployConfig.packages = {};                                                        // 190
  if (!deployConfig.boot)                                                              // 191
    deployConfig.boot = {};                                                            // 192
  if (!deployConfig.boot.bind)                                                         // 193
    deployConfig.boot.bind = {};                                                       // 194
                                                                                       // 195
  // check environment for legacy env variables.                                       // 196
  if (process.env.PORT && !_.has(deployConfig.boot.bind, 'localPort')) {               // 197
    deployConfig.boot.bind.localPort = parseInt(process.env.PORT);                     // 198
  }                                                                                    // 199
  if (process.env.BIND_IP && !_.has(deployConfig.boot.bind, 'localIp')) {              // 200
    deployConfig.boot.bind.localIp = process.env.BIND_IP;                              // 201
  }                                                                                    // 202
  copyEnvVarToDeployConfig(deployConfig, "MONGO_URL", "mongo-livedata", "url");        // 203
                                                                                       // 204
  // webserver                                                                         // 205
  var app = connect();                                                                 // 206
                                                                                       // 207
  // Strip off the path prefix, if it exists.                                          // 208
  app.use(function (request, response, next) {                                         // 209
    var pathPrefix = __meteor_runtime_config__.ROOT_URL_PATH_PREFIX;                   // 210
    var url = Npm.require('url').parse(request.url);                                   // 211
    var pathname = url.pathname;                                                       // 212
    // check if the path in the url starts with the path prefix (and the part          // 213
    // after the path prefix must start with a / if it exists.)                        // 214
    if (pathPrefix && pathname.substring(0, pathPrefix.length) === pathPrefix &&       // 215
       (pathname.length == pathPrefix.length                                           // 216
        || pathname.substring(pathPrefix.length, pathPrefix.length + 1) === "/")) {    // 217
      request.url = request.url.substring(pathPrefix.length);                          // 218
      next();                                                                          // 219
    } else if (pathname === "/favicon.ico" || pathname === "/robots.txt") {            // 220
      next();                                                                          // 221
    } else if (pathPrefix) {                                                           // 222
      response.writeHead(404);                                                         // 223
      response.write("Unknown path");                                                  // 224
      response.end();                                                                  // 225
    } else {                                                                           // 226
      next();                                                                          // 227
    }                                                                                  // 228
  });                                                                                  // 229
  // Parse the query string into res.query. Used by oauth_server, but it's             // 230
  // generally pretty handy..                                                          // 231
  app.use(connect.query());                                                            // 232
                                                                                       // 233
  // Auto-compress any json, javascript, or text.                                      // 234
  app.use(connect.compress());                                                         // 235
                                                                                       // 236
  var staticFiles = {};                                                                // 237
  _.each(clientJson.manifest, function (item) {                                        // 238
    if (item.url && item.where === "client") {                                         // 239
      staticFiles[url.parse(item.url).pathname] = {                                    // 240
        path: item.path,                                                               // 241
        cacheable: item.cacheable,                                                     // 242
        // Link from source to its map                                                 // 243
        sourceMapUrl: item.sourceMapUrl                                                // 244
      };                                                                               // 245
                                                                                       // 246
      if (item.sourceMap) {                                                            // 247
        // Serve the source map too, under the specified URL. We assume all            // 248
        // source maps are cacheable.                                                  // 249
        staticFiles[url.parse(item.sourceMapUrl).pathname] = {                         // 250
          path: item.sourceMap,                                                        // 251
          cacheable: true                                                              // 252
        };                                                                             // 253
      }                                                                                // 254
    }                                                                                  // 255
  });                                                                                  // 256
                                                                                       // 257
  // Serve static files from the manifest.                                             // 258
  // This is inspired by the 'static' middleware.                                      // 259
  app.use(function (req, res, next) {                                                  // 260
    if ('GET' != req.method && 'HEAD' != req.method) {                                 // 261
      next();                                                                          // 262
      return;                                                                          // 263
    }                                                                                  // 264
    var pathname = connect.utils.parseUrl(req).pathname;                               // 265
                                                                                       // 266
    try {                                                                              // 267
      pathname = decodeURIComponent(pathname);                                         // 268
    } catch (e) {                                                                      // 269
      next();                                                                          // 270
      return;                                                                          // 271
    }                                                                                  // 272
    if (!_.has(staticFiles, pathname)) {                                               // 273
      next();                                                                          // 274
      return;                                                                          // 275
    }                                                                                  // 276
                                                                                       // 277
    // We don't need to call pause because, unlike 'static', once we call into         // 278
    // 'send' and yield to the event loop, we never call another handler with          // 279
    // 'next'.                                                                         // 280
                                                                                       // 281
    var info = staticFiles[pathname];                                                  // 282
                                                                                       // 283
    // Cacheable files are files that should never change. Typically                   // 284
    // named by their hash (eg meteor bundled js and css files).                       // 285
    // We cache them ~forever (1yr).                                                   // 286
    //                                                                                 // 287
    // We cache non-cacheable files anyway. This isn't really correct, as users        // 288
    // can change the files and changes won't propagate immediately. However, if       // 289
    // we don't cache them, browsers will 'flicker' when rerendering                   // 290
    // images. Eventually we will probably want to rewrite URLs of static assets       // 291
    // to include a query parameter to bust caches. That way we can both get           // 292
    // good caching behavior and allow users to change assets without delay.           // 293
    // https://github.com/meteor/meteor/issues/773                                     // 294
    var maxAge = info.cacheable                                                        // 295
          ? 1000 * 60 * 60 * 24 * 365                                                  // 296
          : 1000 * 60 * 60 * 24;                                                       // 297
                                                                                       // 298
    // Set the X-SourceMap header, which current Chrome understands.                   // 299
    // (The files also contain '//#' comments which FF 24 understands and              // 300
    // Chrome doesn't understand yet.)                                                 // 301
    //                                                                                 // 302
    // Eventually we should set the SourceMap header but the current version of        // 303
    // Chrome and no version of FF supports it.                                        // 304
    //                                                                                 // 305
    // To figure out if your version of Chrome should support the SourceMap            // 306
    // header,                                                                         // 307
    //   - go to chrome://version. Let's say the Chrome version is                     // 308
    //      28.0.1500.71 and the Blink version is 537.36 (@153022)                     // 309
    //   - go to http://src.chromium.org/viewvc/blink/branches/chromium/1500/Source/core/inspector/InspectorPageAgent.cpp?view=log
    //     where the "1500" is the third part of your Chrome version                   // 311
    //   - find the first revision that is no greater than the "153022"                // 312
    //     number.  That's probably the first one and it probably has                  // 313
    //     a message of the form "Branch 1500 - blink@r149738"                         // 314
    //   - If *that* revision number (149738) is at least 151755,                      // 315
    //     then Chrome should support SourceMap (not just X-SourceMap)                 // 316
    // (The change is https://codereview.chromium.org/15832007)                        // 317
    //                                                                                 // 318
    // You also need to enable source maps in Chrome: open dev tools, click            // 319
    // the gear in the bottom right corner, and select "enable source maps".           // 320
    //                                                                                 // 321
    // Firefox 23+ supports source maps but doesn't support either header yet,         // 322
    // so we include the '//#' comment for it:                                         // 323
    //   https://bugzilla.mozilla.org/show_bug.cgi?id=765993                           // 324
    // In FF 23 you need to turn on `devtools.debugger.source-maps-enabled`            // 325
    // in `about:config` (it is on by default in FF 24).                               // 326
    if (info.sourceMapUrl)                                                             // 327
      res.setHeader('X-SourceMap', info.sourceMapUrl);                                 // 328
                                                                                       // 329
    send(req, path.join(clientDir, info.path))                                         // 330
      .maxage(maxAge)                                                                  // 331
      .hidden(true)  // if we specified a dotfile in the manifest, serve it            // 332
      .on('error', function (err) {                                                    // 333
        Log.error("Error serving static file " + err);                                 // 334
        res.writeHead(500);                                                            // 335
        res.end();                                                                     // 336
      })                                                                               // 337
      .on('directory', function () {                                                   // 338
        Log.error("Unexpected directory " + info.path);                                // 339
        res.writeHead(500);                                                            // 340
        res.end();                                                                     // 341
      })                                                                               // 342
      .pipe(res);                                                                      // 343
  });                                                                                  // 344
                                                                                       // 345
  // Packages and apps can add handlers to this via WebApp.connectHandlers.            // 346
  // They are inserted before our default handler.                                     // 347
  var packageAndAppHandlers = connect();                                               // 348
  app.use(packageAndAppHandlers);                                                      // 349
                                                                                       // 350
  var suppressConnectErrors = false;                                                   // 351
  // connect knows it is an error handler because it has 4 arguments instead of        // 352
  // 3. go figure.  (It is not smart enough to find such a thing if it's hidden        // 353
  // inside packageAndAppHandlers.)                                                    // 354
  app.use(function (err, req, res, next) {                                             // 355
    if (!err || !suppressConnectErrors || !req.headers['x-suppress-error']) {          // 356
      next(err);                                                                       // 357
      return;                                                                          // 358
    }                                                                                  // 359
    res.writeHead(err.status, { 'Content-Type': 'text/plain' });                       // 360
    res.end("An error message");                                                       // 361
  });                                                                                  // 362
                                                                                       // 363
  // Will be updated by main before we listen.                                         // 364
  var boilerplateHtml = null;                                                          // 365
  app.use(function (req, res, next) {                                                  // 366
    if (! appUrl(req.url))                                                             // 367
      return next();                                                                   // 368
                                                                                       // 369
    if (!boilerplateHtml)                                                              // 370
      throw new Error("boilerplateHtml should be set before listening!");              // 371
                                                                                       // 372
    var request = WebApp.categorizeRequest(req);                                       // 373
                                                                                       // 374
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});                  // 375
                                                                                       // 376
    var requestSpecificHtml = htmlAttributes(boilerplateHtml, request);                // 377
    res.write(requestSpecificHtml);                                                    // 378
    res.end();                                                                         // 379
    return undefined;                                                                  // 380
  });                                                                                  // 381
                                                                                       // 382
  // Return 404 by default, if no other handlers serve this URL.                       // 383
  app.use(function (req, res) {                                                        // 384
    res.writeHead(404);                                                                // 385
    res.end();                                                                         // 386
  });                                                                                  // 387
                                                                                       // 388
                                                                                       // 389
  var httpServer = http.createServer(app);                                             // 390
  var onListeningCallbacks = [];                                                       // 391
                                                                                       // 392
  // start up app                                                                      // 393
  _.extend(WebApp, {                                                                   // 394
    connectHandlers: packageAndAppHandlers,                                            // 395
    httpServer: httpServer,                                                            // 396
    // metadata about the client program that we serve                                 // 397
    clientProgram: {                                                                   // 398
      manifest: clientJson.manifest                                                    // 399
      // XXX do we need a "root: clientDir" field here? it used to be here but         // 400
      // was unused.                                                                   // 401
    },                                                                                 // 402
    // For testing.                                                                    // 403
    suppressConnectErrors: function () {                                               // 404
      suppressConnectErrors = true;                                                    // 405
    },                                                                                 // 406
    onListening: function (f) {                                                        // 407
      if (onListeningCallbacks)                                                        // 408
        onListeningCallbacks.push(f);                                                  // 409
      else                                                                             // 410
        f();                                                                           // 411
    },                                                                                 // 412
    // Hack: allow http tests to call connect.basicAuth without making them            // 413
    // Npm.depends on another copy of connect. (That would be fine if we could         // 414
    // have test-only NPM dependencies but is overkill here.)                          // 415
    __basicAuth__: connect.basicAuth                                                   // 416
  });                                                                                  // 417
  // XXX move deployConfig out of __meteor_bootstrap__, after deciding where in        // 418
  // the world it goes. maybe a new deploy-config package?                             // 419
  _.extend(__meteor_bootstrap__, {                                                     // 420
    deployConfig: deployConfig                                                         // 421
  });                                                                                  // 422
                                                                                       // 423
  // Let the rest of the packages (and Meteor.startup hooks) insert connect            // 424
  // middlewares and update __meteor_runtime_config__, then keep going to set up       // 425
  // actually serving HTML.                                                            // 426
  main = function (argv) {                                                             // 427
    argv = optimist(argv).boolean('keepalive').argv;                                   // 428
                                                                                       // 429
    var boilerplateHtmlPath = path.join(clientDir, clientJson.page);                   // 430
    boilerplateHtml =                                                                  // 431
      fs.readFileSync(boilerplateHtmlPath, 'utf8')                                     // 432
      .replace(                                                                        // 433
        "// ##RUNTIME_CONFIG##",                                                       // 434
        "__meteor_runtime_config__ = " +                                               // 435
          JSON.stringify(__meteor_runtime_config__) + ";")                             // 436
      .replace(                                                                        // 437
          /##ROOT_URL_PATH_PREFIX##/g,                                                 // 438
        __meteor_runtime_config__.ROOT_URL_PATH_PREFIX || "");                         // 439
                                                                                       // 440
    // only start listening after all the startup code has run.                        // 441
    var bind = deployConfig.boot.bind;                                                 // 442
    var localPort = bind.localPort || 0;                                               // 443
    var localIp = bind.localIp || '0.0.0.0';                                           // 444
    httpServer.listen(localPort, localIp, Meteor.bindEnvironment(function() {          // 445
      if (argv.keepalive || true)                                                      // 446
        console.log("LISTENING"); // must match run.js                                 // 447
      var port = httpServer.address().port;                                            // 448
      if (bind.viaProxy && bind.viaProxy.proxyEndpoint) {                              // 449
        WebAppInternals.bindToProxy(bind.viaProxy);                                    // 450
      } else if (bind.viaProxy) {                                                      // 451
        // bind via the proxy, but we'll have to find it ourselves via                 // 452
        // ultraworld.                                                                 // 453
        var galaxy = findGalaxy();                                                     // 454
        var proxyServiceName = deployConfig.proxyServiceName || "proxy";               // 455
        galaxy.subscribe('servicesByName', proxyServiceName);                          // 456
        var Proxies = new Meteor.Collection('services', {                              // 457
          manager: galaxy                                                              // 458
        });                                                                            // 459
        var doBinding = function (proxyService) {                                      // 460
          if (proxyService.providers.proxy) {                                          // 461
            Log("Attempting to bind to proxy at " + proxyService.providers.proxy);     // 462
            WebAppInternals.bindToProxy(_.extend({                                     // 463
              proxyEndpoint: proxyService.providers.proxy                              // 464
            }, bind.viaProxy));                                                        // 465
         }                                                                             // 466
        };                                                                             // 467
        Proxies.find().observe({                                                       // 468
          added: doBinding,                                                            // 469
          changed: doBinding                                                           // 470
        });                                                                            // 471
      }                                                                                // 472
                                                                                       // 473
      var callbacks = onListeningCallbacks;                                            // 474
      onListeningCallbacks = null;                                                     // 475
      _.each(callbacks, function (x) { x(); });                                        // 476
    }, function (e) {                                                                  // 477
      console.error("Error listening:", e);                                            // 478
      console.error(e.stack);                                                          // 479
    }));                                                                               // 480
                                                                                       // 481
    if (argv.keepalive)                                                                // 482
      initKeepalive();                                                                 // 483
    return 'DAEMON';                                                                   // 484
  };                                                                                   // 485
};                                                                                     // 486
                                                                                       // 487
WebAppInternals.bindToProxy = function (proxyConfig) {                                 // 488
  var securePort = proxyConfig.securePort || 4433;                                     // 489
  var insecurePort = proxyConfig.insecurePort || 8080;                                 // 490
  var bindPathPrefix = proxyConfig.bindPathPrefix || "";                               // 491
  // XXX also support galaxy-based lookup                                              // 492
  if (!proxyConfig.proxyEndpoint)                                                      // 493
    throw new Error("missing proxyEndpoint");                                          // 494
  if (!proxyConfig.bindHost)                                                           // 495
    throw new Error("missing bindHost");                                               // 496
  // XXX move these into deployConfig?                                                 // 497
  if (!process.env.GALAXY_JOB)                                                         // 498
    throw new Error("missing $GALAXY_JOB");                                            // 499
  if (!process.env.GALAXY_APP)                                                         // 500
    throw new Error("missing $GALAXY_APP");                                            // 501
  if (!process.env.LAST_START)                                                         // 502
    throw new Error("missing $LAST_START");                                            // 503
                                                                                       // 504
  // XXX rename pid argument to bindTo.                                                // 505
  var pid = {                                                                          // 506
    job: process.env.GALAXY_JOB,                                                       // 507
    lastStarted: process.env.LAST_START,                                               // 508
    app: process.env.GALAXY_APP                                                        // 509
  };                                                                                   // 510
  var myHost = os.hostname();                                                          // 511
                                                                                       // 512
  var ddpBindTo = {                                                                    // 513
    ddpUrl: 'ddp://' + proxyConfig.bindHost + ':' + securePort + bindPathPrefix + '/', // 514
    insecurePort: insecurePort                                                         // 515
  };                                                                                   // 516
                                                                                       // 517
  // This is run after packages are loaded (in main) so we can use                     // 518
  // DDP.connect.                                                                      // 519
  var proxy = DDP.connect(proxyConfig.proxyEndpoint);                                  // 520
  var route = process.env.ROUTE;                                                       // 521
  var host = route.split(":")[0];                                                      // 522
  var port = +route.split(":")[1];                                                     // 523
  proxy.call('bindDdp', {                                                              // 524
    pid: pid,                                                                          // 525
    bindTo: ddpBindTo,                                                                 // 526
    proxyTo: {                                                                         // 527
      host: host,                                                                      // 528
      port: port,                                                                      // 529
      pathPrefix: bindPathPrefix + '/websocket'                                        // 530
    }                                                                                  // 531
  });                                                                                  // 532
  proxy.call('bindHttp', {                                                             // 533
    pid: pid,                                                                          // 534
    bindTo: {                                                                          // 535
      host: proxyConfig.bindHost,                                                      // 536
      port: insecurePort,                                                              // 537
      pathPrefix: bindPathPrefix                                                       // 538
    },                                                                                 // 539
    proxyTo: {                                                                         // 540
      host: host,                                                                      // 541
      port: port,                                                                      // 542
      pathPrefix: bindPathPrefix                                                       // 543
    }                                                                                  // 544
  });                                                                                  // 545
  if (proxyConfig.securePort !== null) {                                               // 546
    proxy.call('bindHttp', {                                                           // 547
      pid: pid,                                                                        // 548
      bindTo: {                                                                        // 549
        host: proxyConfig.bindHost,                                                    // 550
        port: securePort,                                                              // 551
        pathPrefix: bindPathPrefix,                                                    // 552
        ssl: true                                                                      // 553
      },                                                                               // 554
      proxyTo: {                                                                       // 555
        host: host,                                                                    // 556
        port: port,                                                                    // 557
        pathPrefix: bindPathPrefix                                                     // 558
      }                                                                                // 559
    });                                                                                // 560
  }                                                                                    // 561
  Log("Bound to proxy");                                                               // 562
};                                                                                     // 563
                                                                                       // 564
runWebAppServer();                                                                     // 565
                                                                                       // 566
/////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.webapp = {
  WebApp: WebApp,
  main: main,
  WebAppInternals: WebAppInternals
};

})();
