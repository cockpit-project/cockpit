s/src: url(.*eot[^'"]*['"]);$//
s/src: url.*glyphicons-halflings-regular.woff.*/font-display: block;\n  src: url('fonts\/glyphicons.woff') format('woff');/
s/src: url.*fontawesome-webfont.woff.*/font-display: block;\n  src: url('fonts\/fontawesome.woff?v=4.2.0') format('woff');/
s/src: url.*PatternFlyIcons-webfont.woff.*/font-display: block;\n  src: url('fonts\/patternfly.woff') format('woff');/
s/src:.*url.*OpenSans-\([^'"]*\).woff.*/font-display: block;\n  src: url('..\/..\/static\/fonts\/OpenSans-\1.woff') format('woff');/
s/src:.*url.*RedHat\([a-zA-Z]\+-[^.]*\).*/font-display: block;\n  src: url('..\/..\/static\/fonts\/RedHat\1.woff2') format('woff2');/
