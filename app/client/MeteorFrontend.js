// This makes sure Meteor isn't trying to connect to a server
Meteor.connection._stream._retryTimeout = function(){ return 365 * 24 * 60 * 60 * 1000};
Meteor.connection._stream._lostConnection();


// Here we create our local (unmanaged) collection(s) to use them in our app
var myCollection = new Meteor.Collection('myCollection', {connection: null});


Template.hello.greeting = function () {
  return "Welcome to Meteor Frontend. Press the buttons below and check you console for output!";
};



Template.hello.events({
  // ADD
  'click button.add' : function () {
    // template data, if any, is available in 'this'
    if (typeof console !== 'undefined')
      console.log("You put some data into the local database, check the console to see whats in there now..");
      myCollection.insert({someData: _.uniqueId('this is document ') });
      console.log(myCollection.find().fetch());
  },
  // RESET
  'click button.reset' : function () {
    // template data, if any, is available in 'this'
    if (typeof console !== 'undefined')
      console.log("Reseted the Database");
      _.each(myCollection.find().fetch(), function(document){
        myCollection.remove({_id: document._id});
      });
      console.log(myCollection.find().fetch());
  }
});


