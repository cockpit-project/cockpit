#!/bin/sh
set -eu

filepath=${1}
cputh=${2}
memth=${3}
freq=${4}
count=${5}

#Check if file exists
if [ -f ${filepath} ];then
   exit 0
else
   touch ${filepath}
   chmod 755 ${filepath}
   echo "MODE ACTIVE"   > ${filepath}
   echo "CPU ${cputh}"   >> ${filepath}
   echo "MEM ${memth}"   >> ${filepath}
   echo "FREQ ${freq}"   >> ${filepath}
   echo "COUNT ${count}" >> ${filepath}
fi
