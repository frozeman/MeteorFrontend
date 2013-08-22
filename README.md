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

Just edit your meteor files inside the `app/client/` folder and run `$ grunt` to generate the distribution package.
This will automatically start a server at http://localhost:9000 to test you distribution package.


Deployment
----------

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