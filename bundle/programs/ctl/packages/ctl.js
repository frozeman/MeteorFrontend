(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;
var DDP = Package.livedata.DDP;
var DDPServer = Package.livedata.DDPServer;
var MongoInternals = Package['mongo-livedata'].MongoInternals;
var Ctl = Package['ctl-helper'].Ctl;

/* Package-scope variables */
var main;

(function () {

/////////////////////////////////////////////////////////////////////////////////
//                                                                             //
// packages/ctl/ctl.js                                                         //
//                                                                             //
/////////////////////////////////////////////////////////////////////////////////
                                                                               //
Ctl.Commands.push({                                                            // 1
  name: "help",                                                                // 2
  func: function (argv) {                                                      // 3
    if (!argv._.length || argv.help)                                           // 4
      Ctl.usage();                                                             // 5
    var cmd = argv._.splice(0,1)[0];                                           // 6
    argv.help = true;                                                          // 7
                                                                               // 8
    Ctl.findCommand(cmd).func(argv);                                           // 9
  }                                                                            // 10
});                                                                            // 11
                                                                               // 12
var mergeObjects = function (obj1, obj2) {                                     // 13
  var result = _.clone(obj1);                                                  // 14
  _.each(obj2, function (v, k) {                                               // 15
    // If both objects have an object at this key, then merge those objects.   // 16
    // Otherwise, choose obj2's value.                                         // 17
    if ((v instanceof Object) && (obj1[k] instanceof Object))                  // 18
      result[k] = mergeObjects(v, obj1[k]);                                    // 19
    else                                                                       // 20
      result[k] = v;                                                           // 21
  });                                                                          // 22
  return result;                                                               // 23
};                                                                             // 24
                                                                               // 25
                                                                               // 26
Ctl.Commands.push({                                                            // 27
  name: "start",                                                               // 28
  help: "Start this app",                                                      // 29
  func: function (argv) {                                                      // 30
    if (argv.help || argv._.length !== 0) {                                    // 31
      process.stderr.write(                                                    // 32
"Usage: ctl start\n" +                                                         // 33
 "\n" +                                                                        // 34
"Starts the app. For now, this just means that it runs the 'server'\n" +       // 35
"program.\n"                                                                   // 36
);                                                                             // 37
      process.exit(1);                                                         // 38
    }                                                                          // 39
                                                                               // 40
    var numServers = Ctl.getJobsByApp(                                         // 41
      Ctl.myAppName(), {program: 'server', done: false}).count();              // 42
    if (numServers === 0) {                                                    // 43
      var appConfig = Ctl.prettyCall(                                          // 44
        Ctl.findGalaxy(), 'getAppConfiguration', [Ctl.myAppName()]);           // 45
                                                                               // 46
      var proxyConfig;                                                         // 47
      var bindPathPrefix = "";                                                 // 48
      if (appConfig.admin) {                                                   // 49
        bindPathPrefix = "/" + Ctl.myAppName();                                // 50
        proxyConfig = {                                                        // 51
          securePort: 44333,                                                   // 52
          insecurePort: 9414,                                                  // 53
          bindHost: "localhost",                                               // 54
          bindPathPrefix: bindPathPrefix                                       // 55
        };                                                                     // 56
      } else {                                                                 // 57
        proxyConfig = {                                                        // 58
          bindHost: appConfig.sitename                                         // 59
        };                                                                     // 60
      }                                                                        // 61
                                                                               // 62
      var deployConfig = {                                                     // 63
        boot: {                                                                // 64
          bind: {                                                              // 65
            viaProxy: proxyConfig                                              // 66
          }                                                                    // 67
        },                                                                     // 68
        packages: {                                                            // 69
          "mongo-livedata": {                                                  // 70
            url: appConfig.MONGO_URL                                           // 71
          },                                                                   // 72
          "email": {                                                           // 73
            url: appConfig.MAIL_URL                                            // 74
          }                                                                    // 75
        },                                                                     // 76
        proxyServiceName: appConfig.proxyServiceName || "proxy"                // 77
      };                                                                       // 78
                                                                               // 79
      // Merge in any values that might have been added to the app's config in // 80
      // the database.                                                         // 81
      if (appConfig.deployConfig)                                              // 82
        deployConfig = mergeObjects(deployConfig, appConfig.deployConfig);     // 83
                                                                               // 84
      // XXX args? env?                                                        // 85
      Ctl.prettyCall(Ctl.findGalaxy(), 'run', [Ctl.myAppName(), 'server', {    // 86
        exitPolicy: 'restart',                                                 // 87
        env: {                                                                 // 88
          METEOR_DEPLOY_CONFIG: JSON.stringify(deployConfig),                  // 89
          ROOT_URL: "https://" + appConfig.sitename + bindPathPrefix,          // 90
          METEOR_SETTINGS: appConfig.METEOR_SETTINGS                           // 91
        },                                                                     // 92
        ports: {                                                               // 93
          "main": {                                                            // 94
            bindEnv: "PORT",                                                   // 95
            routeEnv: "ROUTE"                                                  // 96
          }                                                                    // 97
        },                                                                     // 98
        tags: ["runner"]                                                       // 99
      }]);                                                                     // 100
      console.log("Started a server.");                                        // 101
    } else {                                                                   // 102
      console.log("Server already running.");                                  // 103
    }                                                                          // 104
  }                                                                            // 105
});                                                                            // 106
                                                                               // 107
Ctl.Commands.push({                                                            // 108
  name: "stop",                                                                // 109
  help: "Stop this app",                                                       // 110
  func: function (argv) {                                                      // 111
    if (argv.help || argv._.length !== 0) {                                    // 112
      process.stderr.write(                                                    // 113
"Usage: ctl stop\n" +                                                          // 114
 "\n" +                                                                        // 115
"Stops the app. For now, this just means that it kills all jobs\n" +           // 116
"other than itself.\n"                                                         // 117
);                                                                             // 118
      process.exit(1);                                                         // 119
    }                                                                          // 120
                                                                               // 121
    // Get all jobs (other than this job: don't commit suicide!) that are not  // 122
    // already killed.                                                         // 123
    var jobs = Ctl.getJobsByApp(                                               // 124
      Ctl.myAppName(), {_id: {$ne: Ctl.myJobId()}, done: false});              // 125
    jobs.forEach(function (job) {                                              // 126
      // Don't commit suicide.                                                 // 127
      if (job._id === Ctl.myJobId())                                           // 128
        return;                                                                // 129
      // It's dead, Jim.                                                       // 130
      if (job.done)                                                            // 131
        return;                                                                // 132
      Ctl.kill(job.program, job._id);                                          // 133
    });                                                                        // 134
    console.log("Server stopped.");                                            // 135
  }                                                                            // 136
});                                                                            // 137
                                                                               // 138
                                                                               // 139
Ctl.Commands.push({                                                            // 140
  name: "scale",                                                               // 141
  help: "Scale jobs",                                                          // 142
  func: function (argv) {                                                      // 143
    if (argv.help || argv._.length === 0 || _.contains(argv._, 'ctl')) {       // 144
      process.stderr.write(                                                    // 145
"Usage: ctl scale program1=n [...] \n" +                                       // 146
 "\n" +                                                                        // 147
"Scales some programs. Runs or kills jobs until there are n non-done jobs\n" + // 148
"in that state.\n"                                                             // 149
);                                                                             // 150
      process.exit(1);                                                         // 151
    }                                                                          // 152
                                                                               // 153
    var scales = _.map(argv._, function (arg) {                                // 154
      var m = arg.match(/^(.+)=(\d+)$/);                                       // 155
      if (!m) {                                                                // 156
        console.log("Bad scaling argument; should be program=number.");        // 157
        process.exit(1);                                                       // 158
      }                                                                        // 159
      return {program: m[1], scale: parseInt(m[2])};                           // 160
    });                                                                        // 161
                                                                               // 162
    _.each(scales, function (s) {                                              // 163
      var jobs = Ctl.getJobsByApp(                                             // 164
        Ctl.myAppName(), {program: s.program, done: false});                   // 165
      jobs.forEach(function (job) {                                            // 166
        --s.scale;                                                             // 167
        // Is this an extraneous job, more than the number that we need? Kill  // 168
        // it!                                                                 // 169
        if (s.scale < 0) {                                                     // 170
          Ctl.kill(s.program, job._id);                                        // 171
        }                                                                      // 172
      });                                                                      // 173
      // Now start any jobs that are necessary.                                // 174
      if (s.scale <= 0)                                                        // 175
        return;                                                                // 176
      console.log("Starting %d jobs for %s", s.scale, s.program);              // 177
      _.times(s.scale, function () {                                           // 178
        // XXX args? env?                                                      // 179
        Ctl.prettyCall(Ctl.findGalaxy(), 'run', [Ctl.myAppName(), s.program, { // 180
          exitPolicy: 'restart'                                                // 181
        }]);                                                                   // 182
      });                                                                      // 183
    });                                                                        // 184
  }                                                                            // 185
});                                                                            // 186
                                                                               // 187
main = function (argv) {                                                       // 188
  return Ctl.main(argv);                                                       // 189
};                                                                             // 190
                                                                               // 191
/////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.ctl = {
  main: main
};

})();
