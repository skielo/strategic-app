import { DynamoDBClient, ReturnValue } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({
  ...(process.env.IS_LOCAL && {
    endpoint: "http://localhost:4566",
    region: "us-east-1",
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test"
    }
  })
});
const dynamoDB = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME || '';

interface KeyResult {
  id: string;
  objectiveId: string;
  strategicThemeId: string;
  description: string;
  startDate: string;
  endDate: string;
  currentValue: number;
  goals: string[];
  creationDateUtc: string;
  startDateUtc: string;
  dueDateUtc: string;
  finishAtUtc?: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent) => {
  try {
    switch (event.httpMethod) {
      case 'GET':
        if (event.path.endsWith('/all')) {
          return await getAllKeyResults(event);
        } else {
          return await getKeyResult(event);
        }
      case 'POST':
        return await createKeyResult(event);
      case 'PUT':
        return await updateKeyResult(event);
      case 'DELETE':
        return await deleteKeyResult(event);
      default:
        return { statusCode: 400, body: JSON.stringify({ message: 'Unsupported HTTP method' }) };
    }
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
  }
};

async function getKeyResult(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  const objectiveId = event.queryStringParameters?.objectiveId;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (id && objectiveId && strategicThemeId) {
    const params = {
      TableName: TABLE_NAME,
      Key: {
        PK: `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}`,
        SK: `KEYRESULT#${id}`,
      },
    };

    const result = await dynamoDB.send(new GetCommand(params));
    if (result.Item) {
      return { statusCode: 200, body: JSON.stringify(result.Item) };
    } else {
      return { statusCode: 404, body: JSON.stringify({ message: 'Key Result not found' }) };
    }
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing required parameters' }) };
  }
}

async function getAllKeyResults(event: APIGatewayProxyEvent) {
  const objectiveId = event.queryStringParameters?.objectiveId;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (objectiveId && strategicThemeId) {
    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}`,
        ':sk': 'KEYRESULT#',
      },
    };

    const result = await dynamoDB.send(new QueryCommand(params));
    return { statusCode: 200, body: JSON.stringify(result.Items) };
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing required parameters' }) };
  }
}

async function createKeyResult(event: APIGatewayProxyEvent) {
  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body' }) };
  }
  const keyResult = JSON.parse(event.body) as KeyResult;
  keyResult.id = uuidv4();
  keyResult.creationDateUtc = new Date().toISOString();

  // Check if the objective already has 3-5 key results
  const existingKeyResults = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `STRATEGICTHEME#${keyResult.strategicThemeId}#OBJECTIVE#${keyResult.objectiveId}`,
      ':sk': 'KEYRESULT#',
    },
  }));

  if (existingKeyResults.Items && (existingKeyResults.Items.length < 3 || existingKeyResults.Items.length >= 5)) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Objective must have 3-5 key results' }) };
  }

  const params = {
    TableName: TABLE_NAME,
    Item: {
      PK: `STRATEGICTHEME#${keyResult.strategicThemeId}#OBJECTIVE#${keyResult.objectiveId}`,
      SK: `KEYRESULT#${keyResult.id}`,
      GSI1PK: 'KEYRESULT',
      GSI1SK: keyResult.startDate,
      GSI2PK: 'KEYRESULT',
      GSI2SK: keyResult.endDate,
      ...keyResult,
    },
  };

  await dynamoDB.send(new PutCommand(params));
  return { statusCode: 201, body: JSON.stringify(keyResult) };
}

async function updateKeyResult(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body' }) };
  }
  const updates = JSON.parse(event.body) as Partial<KeyResult>;

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${updates.strategicThemeId}#OBJECTIVE#${updates.objectiveId}`,
      SK: `KEYRESULT#${id}`,
    },
    UpdateExpression: 'set description = :description, startDate = :startDate, endDate = :endDate, currentValue = :currentValue, goals = :goals, startDateUtc = :startDateUtc, dueDateUtc = :dueDateUtc, finishAtUtc = :finishAtUtc',
    ExpressionAttributeValues: {
      ':description': updates.description,
      ':startDate': updates.startDate,
      ':endDate': updates.endDate,
      ':currentValue': updates.currentValue,
      ':goals': updates.goals,
      ':startDateUtc': updates.startDateUtc,
      ':dueDateUtc': updates.dueDateUtc,
      ':finishAtUtc': updates.finishAtUtc,
    },
    ReturnValues: ReturnValue.ALL_NEW,
  };

  const result = await dynamoDB.send(new UpdateCommand(params));
  return { statusCode: 200, body: JSON.stringify(result.Attributes) };
}

async function deleteKeyResult(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  const objectiveId = event.queryStringParameters?.objectiveId;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (!objectiveId || !strategicThemeId) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing required parameters' }) };
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}`,
      SK: `KEYRESULT#${id}`,
    },
  };

  await dynamoDB.send(new DeleteCommand(params));
  return { statusCode: 204, body: '' };
}