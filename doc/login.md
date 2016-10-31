
Cockpit Login
================================

The cockpit login page signs users in by sending requests to /login the a Authorization header.
Generally this will be with a user provided username and password. In that case the authorization
header is built like this.

```
Basic base64(user:password)
```

A successful response is a 200 http code with a json body that contains a ```user``` field with the user
name of the user that was just logged in. Additional fields may be present

Other http codes are considered errors. Generally these are 401 or 403 http status codes.
In most cases the error can detrived from the status text. Examples are
 ```authentication-failed```, ```authentication-unavailable``` or ```permission-denied```
 In some cases additional error messages may be included.

In some authentication setups addtional steps are required. When this happens cockpit will
return a 401 http status code. Along with a WWW-Authenticate challenge header that looks like
this.


```
WWW-Authenticate X-Conversation id base64(prompt)
```

This may be accompanied by a JSON object in the body of the response to provide additional context.

```
{
    "message" : ...
    "error": ...,
    "echo": true or false
}
```

Cockpit will then display the prompt and provide a field for the user to type the answer.
To send the answer the Authorization header is built like this.

```
Authorization: X-Conversation id base64(response)
```

Where id is the same id that was received with the WWW-Authenticate challenge header.

This can continue until either a success or an error response is received.
