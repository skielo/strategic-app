import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { ReturnValue } from "@aws-sdk/client-dynamodb";
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

interface Objective {
  id: string;
  strategicThemeId: string;
  statement: string;
  startDate: string;
  endDate: string;
  keyResults: string[];
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
          return await getAllObjectives(event);
        } else {
          return await getObjective(event);
        }
      case 'POST':
        return await createObjective(event);
      case 'PUT':
        return await updateObjective(event);
      case 'DELETE':
        return await deleteObjective(event);
      default:
        return { statusCode: 400, body: JSON.stringify({ message: 'Unsupported HTTP method' }) };
    }
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
  }
};

async function getObjective(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (id && strategicThemeId) {
    const params = {
      TableName: TABLE_NAME,
      Key: {
        PK: `STRATEGICTHEME#${strategicThemeId}`,
        SK: `OBJECTIVE#${id}`,
      },
    };

    const result = await dynamoDB.send(new GetCommand(params));
    if (result.Item) {
      return { statusCode: 200, body: JSON.stringify(result.Item) };
    } else {
      return { statusCode: 404, body: JSON.stringify({ message: 'Objective not found' }) };
    }
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing id or strategicThemeId' }) };
  }
}

async function getAllObjectives(event: APIGatewayProxyEvent) {
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (strategicThemeId) {
    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `STRATEGICTHEME#${strategicThemeId}`,
        ':sk': 'OBJECTIVE#',
      },
    };

    const result = await dynamoDB.send(new QueryCommand(params));
    return { statusCode: 200, body: JSON.stringify(result.Items) };
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing strategicThemeId' }) };
  }
}

async function createObjective(event: APIGatewayProxyEvent) {
  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body' }) };
  }
  
  let objective: Objective;
  try {
    objective = JSON.parse(event.body) as Objective;
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON in request body' }) };
  }

  objective.id = uuidv4();
  objective.creationDateUtc = new Date().toISOString();

  // Check if the strategic theme already has 3 objectives
  const existingObjectives = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `STRATEGICTHEME#${objective.strategicThemeId}`,
      ':sk': 'OBJECTIVE#',
    },
  }));

  if (existingObjectives.Items && existingObjectives.Items.length >= 3) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Strategic theme already has 3 objectives' }) };
  }

  const params = {
    TableName: TABLE_NAME,
    Item: {
      PK: `STRATEGICTHEME#${objective.strategicThemeId}`,
      SK: `OBJECTIVE#${objective.id}`,
      GSI1PK: 'OBJECTIVE',
      GSI1SK: objective.startDate,
      GSI2PK: 'OBJECTIVE',
      GSI2SK: objective.endDate,
      ...objective,
    },
  };

  await dynamoDB.send(new PutCommand(params));
  return { statusCode: 201, body: JSON.stringify(objective) };
}

async function updateObjective(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing objective id' }) };
  }
  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body' }) };
  }
  
  let updates: Partial<Objective>;
  try {
    updates = JSON.parse(event.body) as Partial<Objective>;
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON in request body' }) };
  }

  if (!updates.strategicThemeId) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing strategicThemeId' }) };
  }

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${updates.strategicThemeId}`,
      SK: `OBJECTIVE#${id}`,
    },
    UpdateExpression: 'set statement = :statement, startDate = :startDate, endDate = :endDate, keyResults = :keyResults, startDateUtc = :startDateUtc, dueDateUtc = :dueDateUtc, finishAtUtc = :finishAtUtc',
    ExpressionAttributeValues: {
      ':statement': updates.statement,
      ':startDate': updates.startDate,
      ':endDate': updates.endDate,
      ':keyResults': updates.keyResults,
      ':startDateUtc': updates.startDateUtc,
      ':dueDateUtc': updates.dueDateUtc,
      ':finishAtUtc': updates.finishAtUtc,
    },
    ReturnValues: ReturnValue.ALL_NEW,
  };

  const result = await dynamoDB.send(new UpdateCommand(params));
  return { statusCode: 200, body: JSON.stringify(result.Attributes) };
}

async function deleteObjective(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing objective id' }) };
  }

  if (!strategicThemeId) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing strategicThemeId' }) };
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${strategicThemeId}`,
      SK: `OBJECTIVE#${id}`,
    },
  };

  await dynamoDB.send(new DeleteCommand(params));
  return { statusCode: 204, body: '' };
}