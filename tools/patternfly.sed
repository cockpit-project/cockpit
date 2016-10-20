s/src: url(.*eot[^']*');$//
s/src: url.*glyphicons-halflings-regular.woff.*/src: url('fonts\/glyphicons.woff') format('woff');/
s/src: url.*fontawesome-webfont.woff.*/src: url('fonts\/fontawesome.woff?v=4.2.0') format('woff');/
s/src: url.*PatternFlyIcons-webfont.woff.*/src: url('fonts\/patternfly.woff') format('woff');/
s/src: url.*OpenSans-\([^']*\).woff.*/src: url('..\/..\/static\/fonts\/OpenSans-\1.woff') format('woff');/
s/url('..\/img\//url('images\//
s/url("..\/img\//url("images\//

