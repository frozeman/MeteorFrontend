Node.js - kexec
===============

This module causes your current Node.js process to be replaced by the process invoked by the parameter of this function. It's like the Ruby exec function. It currently does not work on Windows.

Fully compatible with Node.js version v0.6 and v0.8.


Installation Node v0.6 and v0.8
------------

    npm install kexec@latest



Installation Node v0.4
-------------

    npm install kexec@0.0.3




Usage
-----

```javascript
var kexec = require('kexec');

kexec('top'); //your process now becomes top, can also accept parameters in one string
```



License
-------

(The MIT License)

Copyright (c) 2011-2012 JP Richardson

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files 
(the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify,
 merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE 
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS 
OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


