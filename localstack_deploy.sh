#!/bin/bash

# 1. Start LocalStack
docker-compose build
docker-compose up -d

# 2. Configure AWS credentials for LocalStack
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

# 3. Bootstrap and synthesize your stack locally
npm run local:bootstrap
npm run local:synth

# 4. Deploy your stack
npm run local:deploy