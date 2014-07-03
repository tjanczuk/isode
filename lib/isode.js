var Docker = require('dockerode')
    , async = require('async')
    , http = require('http')
    , path = require('path');

// All containers tunnel stdout and stderr to stdout of the host process.
var attach_options = { 
    stream: true, 
    stdout: true, 
    stderr: true 
};

// All containers are created with a host folder (__dirname)/volumes mounted 
// at /isode location with read only permissions. This volume contains an HTTP server
// code that each container runs.
var start_options = {
    'Binds': [ path.join(__dirname, 'volume') + ':/isode:ro' ]
};

function create (o) {
    o = o || {};
    var options = {
        // The Unix socket where Docker is listening:
        socket_path: o.socket_path || process.env.ISODE_SOCKET_PATH || '/var/run/docker.sock',
        // The Docker image with sandboxed Node.js runtime and selected NPM modules:
        image: o.image || process.env.ISODE_IMAGE || 'dockerfile/nodejs',
    };

    var create_container_options = {
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: ['node', '/isode/server.js'],
        Image: options.image,
        Volumes: { '/isode': {} },
    };    

    var docker = new Docker({ socketPath: options.socket_path });
    var containers = {};

    return {
        run: function (isolate_key, code, cb) {
            if (typeof code !== 'string')
                throw new Error('Code must be a JavaScript string to be evaluated.')
            var container = containers[isolate_key];
            if (Array.isArray(container)) {
                // Add request to requests awaiting creation of a container
                container.push({ code: code, cb: cb });
            }
            else if (!container) {
                // Initialize creation of a container
                var requests = containers[isolate_key] = [ { code: code, cb: cb } ];
                createContainer();
            }
            else {
                runInContainer(container, code, cb)
            }

            function createContainer() {
                var new_container;
                async.series([
                    function (cb) {
                        // Create new docker container for the isolate key
                        docker.createContainer(create_container_options, function (err, result) {
                            new_container = result;
                            cb(err)
                        });
                    },
                    function (cb) {
                        // Attach stdout and stderr from the container to the host process
                        new_container.attach(attach_options, function (err, stream) {
                            if (!err && stream) stream.pipe(process.stdout);
                            cb(err);
                        });
                    },
                    function (cb) {
                        // Start the container
                        new_container.start(start_options, cb);
                    },
                    function (cb) {
                        // Get the settings of the container (including IP address)
                        new_container.inspect(function (err, data) {
                            if (err) 
                                new_container.stop(function () {});
                            else 
                                new_container.settings = data;

                            cb(err);
                        });
                    },
                    function (cb) {
                        // Register container
                        var requests = containers[isolate_key];
                        var container = containers[isolate_key] = {
                            isolate_key: isolate_key,
                            docker_container: new_container,
                            url: 'http://' + new_container.settings.NetworkSettings.IPAddress + ':8721/'
                        };

                        // Unregister container when it terminates
                        new_container.wait(function (err, data) {
                            if (err) throw err;
                            console.log('Container ' + isolate_key + ':' + new_container.id + ' terminated. ', data);
                            delete containers[isolate_key];
                        });

                        // Release all pending code evaluation requests
                        requests.forEach(function (entry) {
                            runInContainer(container, entry.code, entry.cb);
                        });

                        cb();
                    }
                ], function (err) {
                    if (err) {
                        // Error all pending code evaluation requests
                        var requests = containers[isolate_key];
                        requests.forEach(function (entry) {
                            entry.cb && entry.cb(err);
                        });
                        delete containers[isolate_key];
                    }
                });
            }

            function runInContainer(container, code, cb) {
                var options = {
                    hostname: container.docker_container.settings.NetworkSettings.IPAddress,
                    port: 8721,
                    path: '/',
                    method: 'POST'
                };

                var req = http.request(options, function(res) {
                    // res.setEncoding('utf8');
                    var body = '';
                    res.on('data', function (chunk) { body += chunk; });
                    res.on('end', function () {
                        if (res.statusCode !== 200) 
                            return cb(new Error(body));

                        var result;
                        try {
                            result = JSON.parse(body);
                        }
                        catch (e) {
                            cb && cb(new Error('Unable to parse response as JSON: ' + body));
                            return;
                        }

                        cb && cb(null, result);
                    });
                });

                if (typeof cb === 'function')
                    req.on('error', cb);

                req.end(code);
            }
        },

        stop: function (isolate_key, cb) {
            var container = containers[isolate_key];
            if (container && container.docker_container) {
                container.docker_container.stop(cb || function () {});
            }
        },

        close: function (cb) {
            var tmp = containers;
            async.each(
                Object.getOwnPropertyNames(tmp),
                function (isolate_key, cb) {
                    if (tmp[isolate_key] && tmp[isolate_key].docker_container)
                        tmp[isolate_key].docker_container.stop(cb);
                    else
                        cb();
                },
                cb);
        }
    }
};

// The module itself manages a singleton container group
module.exports = create();

// The create function allows creating custom container groups
module.exports.create = create;
