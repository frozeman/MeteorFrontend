(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var _ = Package.underscore._;

/* Package-scope variables */
var Handlebars;

(function () {

///////////////////////////////////////////////////////////////////////////////
//                                                                           //
// packages/handlebars/parse-handlebars.js                                   //
//                                                                           //
///////////////////////////////////////////////////////////////////////////////
                                                                             //
Handlebars = {};                                                             // 1
                                                                             // 2
/* Our format:                                                               // 3
 *                                                                           // 4
 * A 'template' is an array. Each element in it is either                    // 5
 * - a literal string to echo                                                // 6
 * - an escaped substition: ['{', invocation]                                // 7
 * - an unescaped substition: ['!', invocation]                              // 8
 * - a (conditional or iterated) block:                                      // 9
 *   ['#', invocation, template_a, template_b]                               // 10
 *   (the second template is optional)                                       // 11
 * - a partial: ['>', partial_name] (partial_name is a string)               // 12
 *                                                                           // 13
 * An 'invocation' is an array: one or more 'values', then an optional       // 14
 * hash (of which the keys are strings, and the values are 'values'.)        // 15
 *                                                                           // 16
 * An 'identifier' is:                                                       // 17
 * - [depth, key, key, key..]                                                // 18
 * Eg, '../../a.b.c' would be [2, 'a', 'b', 'c']. 'a' would be [0, 'a'].     // 19
 * And 'this' or '.' would be [0].                                           // 20
 *                                                                           // 21
 * A 'value' is either an identifier, or a string, int, or bool.             // 22
 *                                                                           // 23
 * You should provide a block helper 'with' since we will emit calls         // 24
 * to it (if the user passes the second 'context' argument to a              // 25
 * partial.)                                                                 // 26
 */                                                                          // 27
                                                                             // 28
var path = Npm.require('path');                                              // 29
var hbars = Npm.require('handlebars');                                       // 30
                                                                             // 31
// Has keys 'message', 'line'                                                // 32
Handlebars.ParseError = function (message, line) {                           // 33
  this.message = message;                                                    // 34
  if (line)                                                                  // 35
    this.line = line;                                                        // 36
};                                                                           // 37
                                                                             // 38
// Raises Handlebars.ParseError if the Handlebars parser fails. We           // 39
// will do our best to decode the output of Handlebars into a message        // 40
// and a line number.                                                        // 41
                                                                             // 42
// If Handlebars parsing fails, the Handlebars parser error will             // 43
// escape to the caller.                                                     // 44
//                                                                           // 45
Handlebars.to_json_ast = function (code) {                                   // 46
  try {                                                                      // 47
    var ast = hbars.parse(code);                                             // 48
  } catch (e) {                                                              // 49
    // The Handlebars parser throws Error objects with a message             // 50
    // attribute (and nothing else) and we must do our best. Parse           // 51
    // errors include a line number (relative to the start of 'code'         // 52
    // of course) which we'll attempt to parse out. (Handlebars              // 53
    // almost, but not quite copies the line number information onto         // 54
    // the Error object.) Other than parse errors, you also see very         // 55
    // short strings like "else doesn't match unless" (with no               // 56
    // location information.)                                                // 57
    var m = e.message.match(/^Parse error on line (\d+):([\s\S]*)$/)         // 58
    if (m)                                                                   // 59
      throw new Handlebars.ParseError("Parse error:" + m[2], +m[1]);         // 60
                                                                             // 61
    if (e.message)                                                           // 62
      throw new Handlebars.ParseError(e.message);                            // 63
                                                                             // 64
    throw e;                                                                 // 65
  }                                                                          // 66
                                                                             // 67
  // Recreate Handlebars.Exception to properly report error messages         // 68
  // and stack traces. (https://github.com/wycats/handlebars.js/issues/226)  // 69
  makeHandlebarsExceptionsVisible();                                         // 70
                                                                             // 71
  var identifier = function (node) {                                         // 72
    if (node.type !== "ID")                                                  // 73
      throw new Error("got ast node " + node.type + " for identifier");      // 74
    // drop node.isScoped. this is true if there was a 'this' or '.'         // 75
    // anywhere in the path. vanilla handlebars will turn off                // 76
    // helpers lookup if isScoped is true, but this is too restrictive       // 77
    // for us.                                                               // 78
    var ret = [node.depth];                                                  // 79
    // we still want to turn off helper lookup if path starts with 'this.'   // 80
    // as in {{this.foo}}, which means it has to look different from {{foo}} // 81
    // in our AST.  signal the presence of 'this' in our AST using an empty  // 82
    // path segment.                                                         // 83
    if (/^this\./.test(node.original))                                       // 84
      ret.push('');                                                          // 85
    return ret.concat(node.parts);                                           // 86
  };                                                                         // 87
                                                                             // 88
  var value = function (node) {                                              // 89
    // Work around handlebars.js Issue #422 - Negative integers for          // 90
    // helpers get trapped as ID. handlebars doesn't support floating        // 91
    // point, just integers.                                                 // 92
    if (node.type === 'ID' && /^-\d+$/.test(node.string)) {                  // 93
      // Reconstruct node                                                    // 94
      node.type = 'INTEGER';                                                 // 95
      node.integer = node.string;                                            // 96
    }                                                                        // 97
                                                                             // 98
    var choices = {                                                          // 99
      ID: function (node) {return identifier(node);},                        // 100
      STRING: function (node) {return node.string;},                         // 101
      INTEGER: function (node) {return +node.integer;},                      // 102
      BOOLEAN: function (node) {return (node.bool === 'true');}              // 103
    };                                                                       // 104
    if (!(node.type in choices))                                             // 105
      throw new Error("got ast node " + node.type + " for value");           // 106
    return choices[node.type](node);                                         // 107
  };                                                                         // 108
                                                                             // 109
  var hash = function (node) {                                               // 110
    if (node.type !== "hash")                                                // 111
      throw new Error("got ast node " + node.type + " for hash");            // 112
    var ret = {};                                                            // 113
    _.each(node.pairs, function (p) {                                        // 114
      ret[p[0]] = value(p[1]);                                               // 115
    });                                                                      // 116
    return ret;                                                              // 117
  };                                                                         // 118
                                                                             // 119
  var invocation = function (node) {                                         // 120
    if (node.type !== "mustache")                                            // 121
      throw new Error("got ast node " + node.type + " for invocation");      // 122
    var ret = [node.id];                                                     // 123
    ret = ret.concat(node.params);                                           // 124
    ret = _.map(ret, value);                                                 // 125
    if (node.hash)                                                           // 126
      ret.push(hash(node.hash));                                             // 127
    return ret;                                                              // 128
  };                                                                         // 129
                                                                             // 130
  var template = function (nodes) {                                          // 131
    var ret = [];                                                            // 132
                                                                             // 133
    if (!nodes)                                                              // 134
      return [];                                                             // 135
                                                                             // 136
    var choices = {                                                          // 137
      mustache: function (node) {                                            // 138
        ret.push([node.escaped ? '{' : '!', invocation(node)]);              // 139
      },                                                                     // 140
      partial: function (node) {                                             // 141
        var id = identifier(node.id);                                        // 142
        if (id.length !== 2 || id[0] !== 0)                                  // 143
          // XXX actually should just get the literal string the             // 144
          // entered, and avoid identifier parsing                           // 145
          throw new Error("Template names shouldn't contain '.' or '/'");    // 146
        var x = ['>', id[1]];                                                // 147
        if (node.context)                                                    // 148
          x = ['#', [[0, 'with'], identifier(node.context)], [x]];           // 149
        ret.push(x);                                                         // 150
      },                                                                     // 151
      block: function (node) {                                               // 152
        var x = ['#', invocation(node.mustache),                             // 153
                 template(node.program.statements)];                         // 154
        if (node.program.inverse)                                            // 155
          x.push(template(node.program.inverse.statements));                 // 156
        ret.push(x);                                                         // 157
      },                                                                     // 158
      inverse: function (node) {                                             // 159
        ret.push(['#', invocation(node.mustache),                            // 160
                  node.program.inverse &&                                    // 161
                  template(node.program.inverse.statements) || [],           // 162
                  template(node.program.statements)]);                       // 163
      },                                                                     // 164
      content: function (node) {ret.push(node.string);},                     // 165
      comment: function (node) {}                                            // 166
    };                                                                       // 167
                                                                             // 168
    _.each(nodes, function (node) {                                          // 169
      if (!(node.type in choices))                                           // 170
        throw new Error("got ast node " + node.type + " in template");       // 171
      choices[node.type](node);                                              // 172
    });                                                                      // 173
                                                                             // 174
    return ret;                                                              // 175
  };                                                                         // 176
                                                                             // 177
  if (ast.type !== "program")                                                // 178
    throw new Error("got ast node " + node.type + " at toplevel");           // 179
  return template(ast.statements);                                           // 180
};                                                                           // 181
                                                                             // 182
var makeHandlebarsExceptionsVisible = function () {                          // 183
  hbars.Exception = function(message) {                                      // 184
    this.message = message;                                                  // 185
    // In Node, if we don't do this we don't see the message displayed       // 186
    // nor the right stack trace.                                            // 187
    Error.captureStackTrace(this, arguments.callee);                         // 188
  };                                                                         // 189
  hbars.Exception.prototype = new Error();                                   // 190
  hbars.Exception.prototype.name = 'Handlebars.Exception';                   // 191
};                                                                           // 192
                                                                             // 193
///////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.handlebars = {
  Handlebars: Handlebars
};

})();
