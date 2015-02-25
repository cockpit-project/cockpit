#!/bin/bash
 
if npm -g list phantomjs 2>/dev/null | grep phantomjs; then
    echo "pahntomjs already installed"
else    
    yum -y -q install nodejs npm bind-utils realmd sssd
    npm -g install phantomjs
fi
