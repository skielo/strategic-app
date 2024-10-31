import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class BackendStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table
    const table = new dynamodb.Table(this, 'StrategicThemeTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Add GSIs for querying by entity type and date ranges
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
    });

    // Lambda functions
    const strategicThemeFunction = new lambda.Function(this, 'StrategicThemeFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/lambdas/strategicTheme'),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const objectiveFunction = new lambda.Function(this, 'ObjectiveFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/lambdas/objective'),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const keyResultFunction = new lambda.Function(this, 'KeyResultFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/lambdas/keyResult'),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const goalFunction = new lambda.Function(this, 'GoalFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/lambdas/goal'),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Grant Lambda functions read/write permissions to the DynamoDB table
    table.grantReadWriteData(strategicThemeFunction);
    table.grantReadWriteData(objectiveFunction);
    table.grantReadWriteData(keyResultFunction);
    table.grantReadWriteData(goalFunction);

    // API Gateway
    const api = new apigateway.RestApi(this, 'StrategicThemeApi', {
      restApiName: 'Strategic Theme Service',
    });

    const strategicThemes = api.root.addResource('strategic-themes');
    const objectives = api.root.addResource('objectives');
    const keyResults = api.root.addResource('key-results');
    const goals = api.root.addResource('goals');

    const strategicThemeIntegration = new apigateway.LambdaIntegration(strategicThemeFunction);
    const objectiveIntegration = new apigateway.LambdaIntegration(objectiveFunction);
    const keyResultIntegration = new apigateway.LambdaIntegration(keyResultFunction);
    const goalIntegration = new apigateway.LambdaIntegration(goalFunction);

    // CRUD operations for each resource
    ['GET', 'POST', 'PUT', 'DELETE'].forEach(method => {
      strategicThemes.addMethod(method, strategicThemeIntegration);
      objectives.addMethod(method, objectiveIntegration);
      keyResults.addMethod(method, keyResultIntegration);
      goals.addMethod(method, goalIntegration);
    });

    // Add outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL of the API Gateway',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'Name of the DynamoDB table',
    });
  }
}
