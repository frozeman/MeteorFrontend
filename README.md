Meteor Frontend
===============

This is a demo package to automatically decouple the Meteor frontend part from its backend, for solo distribution.


Installation
------------

You need node and npm installed to run the grunt tasks
If some grunt packages are missing, install the following ones.

    $ npm install matchdep
    $ npm install grunt
    $ npm install grunt-open
    $ npm install grunt-contrib-connect
    $ npm install grunt-contrib-clean
    $ npm install grunt-string-replace
    $ npm install grunt-contrib-rename
    $ npm install grunt-contrib-copy
    $ npm install grunt-shell


Usage
-----

to run the meteor server for development got into the `app/` folder and run `$ meteor`.

Just edit your meteor files inside the `app/client/` folder and run `$ grunt` to generate the distribution package.
This will automatically start a server at http://localhost:9000 to test you distribution package.


Deployment
----------

You need to change the `ROOT_URL` variable in the `Gruntfile.js` and set it to the URL of your server, where you want it to deploy.
For deployment just copy the content of the `dist/` folder onto your webserver.

When you use a router you need to configure your webserver in a way that all urls get maped to the index.html file and let the router do its work (e.g. https://github.com/tmeasday/meteor-router)

To further slim down your meteor copy remove the 'standard-app-packages' and add back the following:
(An easy way to do this is to edit the `.meteor/packages` file)

<pre>
meteor
session
deps
templating
spark
handlebars
universal-events
startup
preserve-inputs
service-configuration
audit-argument-checks
check
underscore
json
jsparse
liverange
localstorage
logging
minimongo
ordered-dict
reactive-dict
reload
amplify
http
webapp
minifiers
</pre>


Enjoy!

License
-------

The MIT License (MIT)

Copyright (c) 2013 Fabian Vogelsteller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.