Copyright (c) 2016 Hilscher Gesellschaft fuer Systemautomation mbH
See Hilscher_Source_Code_License.txt



# semantic-ui

  * create \
    this semantic-ui component is create with npm package and use all minified files only

  * download semanitc ui \
    $ npm install -g gulp \
    $ npm install semantic-ui@2.4.2 \
    $ cd semantic \
    $ gulp build

  * copy all fonts and minified components files to your project directory \
    $ cp -rf themes <projectdir>/semantic-ui \
    $ mkdir <projectdir>/semantic-ui/components \
    $ cp -rf components/*.min* <projectdir>/semantic-ui/components \

  * create googleapi folder \
    $ mkdir -p <projectdir>/semantic-ui/googleApi/fonts/gstatic

  * download googleapi and copy the text from \
    https://fonts.googleapis.com/css?family=Lato:400,700,400italic,700italic&subset=latin \
    in '<projectdir>/semantic-ui/googleApi/googleapi.css'

  * download googleapi fonts

    $ cd <projectdir>/semantic-ui/googleApi

    $ curl https://fonts.gstatic.com/s/lato/v15/S6u8w4BMUTPHjxsAUi-qJCY.woff2 -o lato_S6u8w4BMUTPHjxsAUi-qJCY.woff2 \
    $ curl https://fonts.gstatic.com/s/lato/v15/S6u8w4BMUTPHjxsAXC-q.woff2 -o lato_S6u8w4BMUTPHjxsAXC-q.woff2 \
    $ curl https://fonts.gstatic.com/s/lato/v15/S6u9w4BMUTPHh6UVSwaPGR_p.woff2 -o lato_S6u9w4BMUTPHh6UVSwaPGR_p.woff2 \
    $ curl https://fonts.gstatic.com/s/lato/v15/S6u9w4BMUTPHh6UVSwiPGQ.woff2-o lato_S6u9w4BMUTPHh6UVSwiPGQ.woff2 \
    $ curl https://fonts.gstatic.com/s/lato/v15/S6u_w4BMUTPHjxsI5wq_FQft1dw.woff2 -o lato_S6u_w4BMUTPHjxsI5wq_FQft1dw.woff2 \
    $ curl https://fonts.gstatic.com/s/lato/v15/S6u_w4BMUTPHjxsI5wq_Gwft.woff2 -o lato_S6u_w4BMUTPHjxsI5wq_Gwft.woff2 \
    $ curl https://fonts.gstatic.com/s/lato/v15/S6uyw4BMUTPHjx4wXg.woff2 -o lato_S6uyw4BMUTPHjx4wXg.woff2 \
    $ curl https://fonts.gstatic.com/s/lato/v15/S6uyw4BMUTPHjxAwXjeu.woff2 -o lato_S6uyw4BMUTPHjxAwXjeu.woff2 \
    $ mv *.woff2 fonts/gstatic