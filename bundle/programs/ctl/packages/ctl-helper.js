(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;
var DDP = Package.livedata.DDP;
var DDPServer = Package.livedata.DDPServer;
var MongoInternals = Package['mongo-livedata'].MongoInternals;

/* Package-scope variables */
var Ctl;

(function () {

////////////////////////////////////////////////////////////////////////////////////////
//                                                                                    //
// packages/ctl-helper/ctl-helper.js                                                  //
//                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////
                                                                                      //
var optimist = Npm.require('optimist');                                               // 1
var Future = Npm.require('fibers/future');                                            // 2
                                                                                      // 3
Ctl = {};                                                                             // 4
                                                                                      // 5
_.extend(Ctl, {                                                                       // 6
  Commands: [],                                                                       // 7
                                                                                      // 8
  main: function (argv) {                                                             // 9
    var opt = optimist(argv)                                                          // 10
          .alias('h', 'help')                                                         // 11
          .boolean('help');                                                           // 12
    argv = opt.argv;                                                                  // 13
                                                                                      // 14
    if (argv.help) {                                                                  // 15
      argv._.splice(0, 0, "help");                                                    // 16
      delete argv.help;                                                               // 17
    }                                                                                 // 18
                                                                                      // 19
    var cmdName = 'help';                                                             // 20
    if (argv._.length)                                                                // 21
      cmdName = argv._.splice(0,1)[0];                                                // 22
                                                                                      // 23
    Ctl.findCommand(cmdName).func(argv);                                              // 24
    return 0;                                                                         // 25
  },                                                                                  // 26
                                                                                      // 27
  findCommand: function (name) {                                                      // 28
    var cmd = _.where(Ctl.Commands, { name: name })[0];                               // 29
    if (! cmd) {                                                                      // 30
      console.log("'" + name + "' is not a ctl command. See 'ctl --help'.");          // 31
      process.exit(1);                                                                // 32
    }                                                                                 // 33
                                                                                      // 34
    return cmd;                                                                       // 35
  },                                                                                  // 36
                                                                                      // 37
  findGalaxy: _.once(function () {                                                    // 38
    if (!('GALAXY' in process.env)) {                                                 // 39
      console.log(                                                                    // 40
        "GALAXY environment variable must be set. See 'galaxy --help'.");             // 41
      process.exit(1);                                                                // 42
    }                                                                                 // 43
                                                                                      // 44
    return DDP.connect(process.env['GALAXY']);                                        // 45
  }),                                                                                 // 46
                                                                                      // 47
  jobsCollection: _.once(function () {                                                // 48
    return new Meteor.Collection("jobs", {manager: Ctl.findGalaxy()});                // 49
  }),                                                                                 // 50
                                                                                      // 51
  // use _.memoize so that this is called only once per app.                          // 52
  subscribeToAppJobs: _.memoize(function (appName) {                                  // 53
    Ctl.findGalaxy()._subscribeAndWait("jobsByApp", [appName]);                       // 54
  }),                                                                                 // 55
                                                                                      // 56
  // XXX this never unsubs...                                                         // 57
  getJobsByApp: function (appName, restOfSelector) {                                  // 58
    var galaxy = Ctl.findGalaxy();                                                    // 59
    Ctl.subscribeToAppJobs(appName);                                                  // 60
    var selector = {app: appName};                                                    // 61
    if (restOfSelector)                                                               // 62
      _.extend(selector, restOfSelector);                                             // 63
    return Ctl.jobsCollection().find(selector);                                       // 64
  },                                                                                  // 65
                                                                                      // 66
  myAppName: _.once(function () {                                                     // 67
    if (!('GALAXY_APP' in process.env)) {                                             // 68
      console.log("GALAXY_APP environment variable must be set.");                    // 69
      process.exit(1);                                                                // 70
    }                                                                                 // 71
    return process.env.GALAXY_APP;                                                    // 72
  }),                                                                                 // 73
                                                                                      // 74
  myJobId: _.once(function () {                                                       // 75
    if (!('GALAXY_JOB' in process.env)) {                                             // 76
      console.log("GALAXY_JOB environment variable must be set.");                    // 77
      process.exit(1);                                                                // 78
    }                                                                                 // 79
    return process.env.GALAXY_JOB;                                                    // 80
  }),                                                                                 // 81
                                                                                      // 82
  usage: function() {                                                                 // 83
    process.stdout.write(                                                             // 84
      "Usage: ctl [--help] <command> [<args>]\n" +                                    // 85
        "\n" +                                                                        // 86
        "For now, the GALAXY environment variable must be set to the location of\n" + // 87
        "your Galaxy management server (Ultraworld.) This string is in the same\n" +  // 88
        "format as the argument to DDP.connect().\n" +                                // 89
        "\n" +                                                                        // 90
        "Commands:\n");                                                               // 91
    _.each(Ctl.Commands, function (cmd) {                                             // 92
      if (cmd.help && ! cmd.hidden) {                                                 // 93
        var name = cmd.name + "                ".substr(cmd.name.length);             // 94
        process.stdout.write("   " + name + cmd.help + "\n");                         // 95
      }                                                                               // 96
    });                                                                               // 97
    process.stdout.write("\n");                                                       // 98
    process.stdout.write(                                                             // 99
      "See 'ctl help <command>' for details on a command.\n");                        // 100
    process.exit(1);                                                                  // 101
  },                                                                                  // 102
                                                                                      // 103
  // XXX copied to meteor/tools/deploy-galaxy.js                                      // 104
  exitWithError: function (error, messages) {                                         // 105
    messages = messages || {};                                                        // 106
                                                                                      // 107
    if (! (error instanceof Meteor.Error))                                            // 108
      throw error; // get a stack                                                     // 109
                                                                                      // 110
    var msg = messages[error.error];                                                  // 111
    if (msg)                                                                          // 112
      process.stderr.write(msg + "\n");                                               // 113
    else if (error instanceof Meteor.Error)                                           // 114
      process.stderr.write("Denied: " + error.message + "\n");                        // 115
                                                                                      // 116
    process.exit(1);                                                                  // 117
  },                                                                                  // 118
                                                                                      // 119
  // XXX copied to meteor/tools/deploy-galaxy.js                                      // 120
  prettyCall: function (galaxy, name, args, messages) {                               // 121
    try {                                                                             // 122
      var ret = galaxy.apply(name, args);                                             // 123
    } catch (e) {                                                                     // 124
      Ctl.exitWithError(e, messages);                                                 // 125
    }                                                                                 // 126
    return ret;                                                                       // 127
  },                                                                                  // 128
                                                                                      // 129
  kill: function (programName, jobId) {                                               // 130
  console.log("Killing %s (%s)", programName, jobId);                                 // 131
  Ctl.prettyCall(Ctl.findGalaxy(), 'kill', [jobId]);                                  // 132
  }                                                                                   // 133
});                                                                                   // 134
                                                                                      // 135
////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package['ctl-helper'] = {
  Ctl: Ctl
};

})();
