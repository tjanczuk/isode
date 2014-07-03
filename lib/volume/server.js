/* 

This HTTP server runs in a Docker container. It accepts HTTP POST requests
with JavaScript (Node.js) code to be evaluated within the process. The JavaScript
code submitted must return a function which accepts a single callback parameter.
The callback parameter must be called with two arguments: an error and a data item. 
In the absence of error, the data item will be JSON-serialized and returned in the 
HTTP POST response. For example:

Request:

    POST / HTTP/1.1
    Content-Length: 39
    Content-Type: application/javascript

    return function (cb) { cb(null, 112); }

Response:

    HTTP/1.1 200 OK
    Content-Type: application/json
    Date: Thu, 03 Jul 2014 18:40:23 GMT
    Connection: keep-alive

    112

The server returns HTTP 400 for problems with evaluating the submitted JavaScript code.
It returns HTTP 500 for errors when running the evaluated code. HTTP 200 is returned for
successful execution. In all cases response body is application/json. 

*/ 

require('http').createServer(function (req, res) {

    if (req.method !== 'POST') {
        res.writeHead(404);
        return res.end();
    }

    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
        try {
            var factory = eval('(function () { ' + body + '})');
            var func = factory();
            if (typeof func !== 'function')
                throw new Error('The code does not return a JavaScript function.');
            func(function (err, data) {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        code: 500,
                        error: 'Error when executing JavaScript code.',
                        details: err.toString()
                    }, null, 2));
                }

                try {
                    body = data ? JSON.stringify(data) : '{}';
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                }
                catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    body = JSON.stringify({
                        code: 500,
                        error: 'Error when JSON serializing the result of the JavaScript code.',
                        details: e.toString()                        
                    });
                }

                return res.end(body);
            });
        }
        catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                code: 400,
                error: 'Unable to compile submitted JavaScript. The code must return a JavaScript function '
                + 'which accepts a single callback parameter, e.g. `return function (cb) { cb(null, "hello"); }`.',
                detail: e.toString()
            }, null, 2));
        }
    });

}).listen(process.env.PORT || 8721);
