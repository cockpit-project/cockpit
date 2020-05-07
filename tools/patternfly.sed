s/src:url[(]"patternfly-icons-fake-path\/glyphicons-halflings-regular[^}]*/font-display:block; src:url('fonts\/glyphicons.woff')format('woff');/
s/src:url[(]"patternfly-icons-fake-path\/pficon[^}]*/src:url('fonts\/patternfly.woff')format('woff');/
s/src:url[(]"patternfly-fonts-fake-path\/PatternFlyIcons[^}]*/src:url('fonts\/patternfly.woff')format('woff');/
s/src:url[(]"patternfly-fonts-fake-path\/fontawesome[^}]*/font-display:block; src:url('fonts\/fontawesome.woff?v=4.2.0')format('woff');/
s/@font-face[^}]*patternfly-fonts-fake-path[^}]*}//g
