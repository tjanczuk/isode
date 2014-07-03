Isode: Docker based isolation for multi-tenant Node.js
====

Isode allows you to safely and efficiently run untrusted, multi-tenant Node.js code within your Node.js application. Its isolation mechanism is based on reusable Docker containers.

### Getting started

You need:

* Linux (tested with [Ubuntu 14.04 LTS](http://www.ubuntu.com/download)).  
* [Docker](http://docker.com).  
* a Docker image that defines the Node.js sandbox to execute code in, installed on the machine with `docker pull` or similar mechanism. Tested with [dockerfile/nodejs](https://registry.hub.docker.com/u/dockerfile/nodejs/).  
* [Node.js](http://nodejs.orc) >= v0.10 (tested with v0.10.29).  

Install isode:

```
npm install https://github.com/tjanczuk/isode.git
```

Run isolated Node.js code in Docker containers managed by isode:

```javascript
var isode = require('isode');

isode.run('tenant1', 'return function (cb) { cb(null, "Hello, world!"); }', function (err, data) {
    if (error) throw error;
    console.log('Tenant 1 result:', data);
});

isode.run('tenant2', 'return function (cb) { cb(null, process.versions); }', function (err, data) {
    if (error) throw error;
    console.log('Tenant 2 result:', data);
});

setTimeout(function () {
    // wind down Docker containers after 5s to allow the process to exit
    isode.close();
}, 10000);
```

### Configuration

Isode behavior can be controlled with environment variables:

`ISODE_SOCKET_PATH` is a Unix socket address of the Docker deamon. Default */var/run/docker.sock*. 

`ISODE_IMAGE` is a Docker image name that defines a Node.js sandbox to execute custom code in. The sandbox MUST provide a Node.js runtime, and MAY provide additional Node.js modules installed globally with npm, depending on your needs. The image must be already installed on the host machine. Default is *dockerfile/nodejs*, which provides the latest Node.js runtime but no external npm modules.

### Current design

1. Isode maintains a group of Docker containers to execute untrusted JavaScript code in. Docker containers provide data and OS resource isolation and ensure fairness of OS resource utilization. They are designed to allow execution of untrusted, multi-tenant code.  
2. Each container executes code from a single tenant only, identified uniquely with a string *isolate_key*. 
3. Each container can execute multiple snippets of code concurrently. It runs an HTTP server which accepts snippets of JavaScript to execute from the isode module running in the host application.  
4. Application requests custom code to be executed with a call to `isode.run`. It provides *isolate_key* which is a string uniquely identifying the tenant (trust domain), and JavaScript code literal to execute. 
4. If there is already a running Docker container associated with the *isolate_key*, the request is sent to that container. Otherwise a new Docker container is created and associated with the *isolate_key*. 

### Target design
 
1. Pooling. Isode will maintain a pool of pre-created Docker containers to speed up processing of requests from tenants for which no container exists yet. This is to avoid the cold startup latency of a container (~400ms) in a situation of regular system load.  
2. Container lifetime management. Containers will be recycled when they are no longer in use. This will be controlled with configurable idle timeout. Recyled containers will be immediately replaced with new containers added to the pool of pre-created containers. 
3. Graceful degradation. Number of active Docker containers will fluctuate between a low (L) and high (H) watermark number. Isode will always ensure there are at least L containers in the system (some may be unassigned to a tenant yet). In case of number of concurrent tenants exceeding L, isode will create containers on demand up to H active containers in the system (this will incurr larger latency than taking a pre-created container from a pool). Active tenants above H will be queued up waiting for an allotment of a container, which will further degrade latency.  