var exec = require('child_process').exec
  , path = require('path')
  , assert = require('assert');


suite('kexec')

test('+ kexec() - kexec echo', function(done) {
   var echoFile = path.join(__dirname, './files/echo.sh'); 

    exec(echoFile, function(error, stdout, stderr) {
        assert(stdout.trim() === 'hello world');
        done(); 
    });
})

