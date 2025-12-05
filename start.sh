#!/bin/bash

echo "FACTORY_API_KEY 当前值是" $FACTORY_API_KEY
echo $FACTORY_API_KEY
echo "Reset FACTORY_API_KEY..."
export FACTORY_API_KEY=""
echo "Starting droid2api server..."
node server.js
