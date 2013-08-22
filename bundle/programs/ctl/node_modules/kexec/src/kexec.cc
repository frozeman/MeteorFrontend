
#include <v8.h>
#include <node.h>
#include <cstdio>

//#ifdef __POSIX__
#include <unistd.h>
/*#else
#include <process.h>
#endif*/

using namespace node;
using namespace v8;



static int clear_cloexec (int desc)
{
    int flags = fcntl (desc, F_GETFD, 0);
    if (flags <  0)
        return flags; //return if reading failed
   
    flags &= ~FD_CLOEXEC; //clear FD_CLOEXEC bit
    return fcntl (desc, F_SETFD, flags);
}

static Handle<Value> kexec(const Arguments& args) {
	HandleScope scope;
    String::Utf8Value v8str(args[0]);
    char* argv[] = { const_cast<char *>(""), const_cast<char *>("-c"), *v8str, NULL};

    clear_cloexec(0); //stdin
    clear_cloexec(1); //stdout
    clear_cloexec(2); //stderr
    int err = execvp("/bin/sh", argv);
    Local<Number> num = Number::New(err);
    return scope.Close(num/*Undefined()*/);
}

extern "C" {
    static void init (Handle<Object> target) {
        NODE_SET_METHOD(target, "kexec", kexec);
    }

    NODE_MODULE(kexec, init);
}



