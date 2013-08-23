(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;

/* Package-scope variables */
var Random;

(function () {

//////////////////////////////////////////////////////////////////////////////////////
//                                                                                  //
// packages/random/random.js                                                        //
//                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////
                                                                                    //
// see http://baagoe.org/en/wiki/Better_random_numbers_for_javascript               // 1
// for a full discussion and Alea implementation.                                   // 2
var Alea = function () {                                                            // 3
  function Mash() {                                                                 // 4
    var n = 0xefc8249d;                                                             // 5
                                                                                    // 6
    var mash = function(data) {                                                     // 7
      data = data.toString();                                                       // 8
      for (var i = 0; i < data.length; i++) {                                       // 9
        n += data.charCodeAt(i);                                                    // 10
        var h = 0.02519603282416938 * n;                                            // 11
        n = h >>> 0;                                                                // 12
        h -= n;                                                                     // 13
        h *= n;                                                                     // 14
        n = h >>> 0;                                                                // 15
        h -= n;                                                                     // 16
        n += h * 0x100000000; // 2^32                                               // 17
      }                                                                             // 18
      return (n >>> 0) * 2.3283064365386963e-10; // 2^-32                           // 19
    };                                                                              // 20
                                                                                    // 21
    mash.version = 'Mash 0.9';                                                      // 22
    return mash;                                                                    // 23
  }                                                                                 // 24
                                                                                    // 25
  return (function (args) {                                                         // 26
    var s0 = 0;                                                                     // 27
    var s1 = 0;                                                                     // 28
    var s2 = 0;                                                                     // 29
    var c = 1;                                                                      // 30
                                                                                    // 31
    if (args.length == 0) {                                                         // 32
      args = [+new Date];                                                           // 33
    }                                                                               // 34
    var mash = Mash();                                                              // 35
    s0 = mash(' ');                                                                 // 36
    s1 = mash(' ');                                                                 // 37
    s2 = mash(' ');                                                                 // 38
                                                                                    // 39
    for (var i = 0; i < args.length; i++) {                                         // 40
      s0 -= mash(args[i]);                                                          // 41
      if (s0 < 0) {                                                                 // 42
        s0 += 1;                                                                    // 43
      }                                                                             // 44
      s1 -= mash(args[i]);                                                          // 45
      if (s1 < 0) {                                                                 // 46
        s1 += 1;                                                                    // 47
      }                                                                             // 48
      s2 -= mash(args[i]);                                                          // 49
      if (s2 < 0) {                                                                 // 50
        s2 += 1;                                                                    // 51
      }                                                                             // 52
    }                                                                               // 53
    mash = null;                                                                    // 54
                                                                                    // 55
    var random = function() {                                                       // 56
      var t = 2091639 * s0 + c * 2.3283064365386963e-10; // 2^-32                   // 57
      s0 = s1;                                                                      // 58
      s1 = s2;                                                                      // 59
      return s2 = t - (c = t | 0);                                                  // 60
    };                                                                              // 61
    random.uint32 = function() {                                                    // 62
      return random() * 0x100000000; // 2^32                                        // 63
    };                                                                              // 64
    random.fract53 = function() {                                                   // 65
      return random() +                                                             // 66
        (random() * 0x200000 | 0) * 1.1102230246251565e-16; // 2^-53                // 67
    };                                                                              // 68
    random.version = 'Alea 0.9';                                                    // 69
    random.args = args;                                                             // 70
    return random;                                                                  // 71
                                                                                    // 72
  } (Array.prototype.slice.call(arguments)));                                       // 73
};                                                                                  // 74
                                                                                    // 75
var UNMISTAKABLE_CHARS = "23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz"; // 76
                                                                                    // 77
var create = function (/* arguments */) {                                           // 78
                                                                                    // 79
  var random = Alea.apply(null, arguments);                                         // 80
                                                                                    // 81
  var self = {};                                                                    // 82
                                                                                    // 83
  var bind = function (fn) {                                                        // 84
    return _.bind(fn, self);                                                        // 85
  };                                                                                // 86
                                                                                    // 87
  return _.extend(self, {                                                           // 88
    _Alea: Alea,                                                                    // 89
                                                                                    // 90
    create: create,                                                                 // 91
                                                                                    // 92
    fraction: random,                                                               // 93
                                                                                    // 94
    choice: bind(function (arrayOrString) {                                         // 95
      var index = Math.floor(this.fraction() * arrayOrString.length);               // 96
      if (typeof arrayOrString === "string")                                        // 97
        return arrayOrString.substr(index, 1);                                      // 98
      else                                                                          // 99
        return arrayOrString[index];                                                // 100
    }),                                                                             // 101
                                                                                    // 102
    id: bind(function() {                                                           // 103
      var digits = [];                                                              // 104
      // Length of 17 preserves around 96 bits of entropy, which is the             // 105
      // amount of state in our PRNG                                                // 106
      for (var i = 0; i < 17; i++) {                                                // 107
        digits[i] = this.choice(UNMISTAKABLE_CHARS);                                // 108
      }                                                                             // 109
      return digits.join("");                                                       // 110
    }),                                                                             // 111
                                                                                    // 112
    hexString: bind(function (digits) {                                             // 113
      var hexDigits = [];                                                           // 114
      for (var i = 0; i < digits; ++i) {                                            // 115
        hexDigits.push(this.choice("0123456789abcdef"));                            // 116
      }                                                                             // 117
      return hexDigits.join('');                                                    // 118
    })                                                                              // 119
  });                                                                               // 120
};                                                                                  // 121
                                                                                    // 122
// instantiate RNG.  Heuristically collect entropy from various sources             // 123
                                                                                    // 124
// client sources                                                                   // 125
var height = (typeof window !== 'undefined' && window.innerHeight) ||               // 126
      (typeof document !== 'undefined'                                              // 127
       && document.documentElement                                                  // 128
       && document.documentElement.clientHeight) ||                                 // 129
      (typeof document !== 'undefined'                                              // 130
       && document.body                                                             // 131
       && document.body.clientHeight) ||                                            // 132
      1;                                                                            // 133
                                                                                    // 134
var width = (typeof window !== 'undefined' && window.innerWidth) ||                 // 135
      (typeof document !== 'undefined'                                              // 136
       && document.documentElement                                                  // 137
       && document.documentElement.clientWidth) ||                                  // 138
      (typeof document !== 'undefined'                                              // 139
       && document.body                                                             // 140
       && document.body.clientWidth) ||                                             // 141
      1;                                                                            // 142
                                                                                    // 143
var agent = (typeof navigator !== 'undefined' && navigator.userAgent) || "";        // 144
                                                                                    // 145
// server sources                                                                   // 146
var pid = (typeof process !== 'undefined' && process.pid) || 1;                     // 147
                                                                                    // 148
// XXX On the server, use the crypto module (OpenSSL) instead of this PRNG.         // 149
//     (Make Random.fraction be generated from Random.hexString instead of the      // 150
//     other way around, and generate Random.hexString from crypto.randomBytes.)    // 151
Random = create([                                                                   // 152
  new Date(), height, width, agent, pid, Math.random()                              // 153
]);                                                                                 // 154
                                                                                    // 155
//////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

//////////////////////////////////////////////////////////////////////////////////////
//                                                                                  //
// packages/random/deprecated.js                                                    //
//                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////
                                                                                    //
// Before this package existed, we used to use this Meteor.uuid()                   // 1
// implementing the RFC 4122 v4 UUID. It is no longer documented                    // 2
// and will go away.                                                                // 3
// XXX COMPAT WITH 0.5.6                                                            // 4
Meteor.uuid = function () {                                                         // 5
  var HEX_DIGITS = "0123456789abcdef";                                              // 6
  var s = [];                                                                       // 7
  for (var i = 0; i < 36; i++) {                                                    // 8
    s[i] = Random.choice(HEX_DIGITS);                                               // 9
  }                                                                                 // 10
  s[14] = "4";                                                                      // 11
  s[19] = HEX_DIGITS.substr((parseInt(s[19],16) & 0x3) | 0x8, 1);                   // 12
  s[8] = s[13] = s[18] = s[23] = "-";                                               // 13
                                                                                    // 14
  var uuid = s.join("");                                                            // 15
  return uuid;                                                                      // 16
};                                                                                  // 17
                                                                                    // 18
//////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.random = {
  Random: Random
};

})();
