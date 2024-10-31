import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

interface StrategicTheme {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  currentValue: number;
  objectives: string[];
  creationDateUtc: string;
  startDateUtc: string;
  dueDateUtc: string;
  finishAtUtc?: string;
  quarter: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent) => {
  try {
    switch (event.httpMethod) {
      case 'GET':
        if (event.path.endsWith('/all')) {
          return await getAllStrategicThemes(event);
        } else {
          return await getStrategicTheme(event);
        }
      case 'POST':
        return await createStrategicTheme(event);
      case 'PUT':
        return await updateStrategicTheme(event);
      case 'DELETE':
        return await deleteStrategicTheme(event);
      default:
        return { statusCode: 400, body: JSON.stringify({ message: 'Unsupported HTTP method' }) };
    }
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
  }
};

async function getStrategicTheme(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;

  if (id) {
    const params = {
      TableName: TABLE_NAME,
      Key: {
        PK: `STRATEGICTHEME#${id}`,
        SK: `STRATEGICTHEME#${id}`,
      },
    };

    const result = await dynamoDB.send(new GetCommand(params));
    if (result.Item) {
      return { statusCode: 200, body: JSON.stringify(result.Item) };
    } else {
      return { statusCode: 404, body: JSON.stringify({ message: 'Strategic Theme not found' }) };
    }
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing id parameter' }) };
  }
}

async function getAllStrategicThemes(event: APIGatewayProxyEvent) {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': 'STRATEGICTHEME',
    },
  };

  const result = await dynamoDB.send(new QueryCommand(params));
  return { statusCode: 200, body: JSON.stringify(result.Items) };
}

async function createStrategicTheme(event: APIGatewayProxyEvent) {
  if (!event.body) {
    throw new Error('Invalid request body');
  }
  let strategicTheme: StrategicTheme;
  try {
    strategicTheme = JSON.parse(event.body) as StrategicTheme;
  } catch (error) {
    throw new Error('Invalid JSON in request body');
  }
  strategicTheme.id = uuidv4();
  strategicTheme.creationDateUtc = new Date().toISOString();
  strategicTheme.quarter = getQuarter(new Date(strategicTheme.startDate));

  const params = {
    TableName: TABLE_NAME,
    Item: {
      PK: `STRATEGICTHEME#${strategicTheme.id}`,
      SK: `STRATEGICTHEME#${strategicTheme.id}`,
      GSI1PK: 'STRATEGICTHEME',
      GSI1SK: strategicTheme.startDate,
      GSI2PK: 'STRATEGICTHEME',
      GSI2SK: strategicTheme.endDate,
      ...strategicTheme,
    },
  };

  await dynamoDB.send(new PutCommand(params));
  return { statusCode: 201, body: JSON.stringify(strategicTheme) };
}

async function updateStrategicTheme(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  if (!id) {
    throw new Error('Missing strategic theme ID');
  }

  if (!event.body) {
    throw new Error('Invalid request body');
  }

  let updates: Partial<StrategicTheme>;
  try {
    updates = JSON.parse(event.body);
  } catch (error) {
    throw new Error('Invalid JSON in request body');
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${id}`,
      SK: `STRATEGICTHEME#${id}`,
    },
    UpdateExpression: 'set #name = :name, description = :description, startDate = :startDate, endDate = :endDate, currentValue = :currentValue, objectives = :objectives, startDateUtc = :startDateUtc, dueDateUtc = :dueDateUtc, finishAtUtc = :finishAtUtc',
    ExpressionAttributeNames: {
      '#name': 'name',
    },
    ExpressionAttributeValues: {
      ':name': updates.name,
      ':description': updates.description,
      ':startDate': updates.startDate,
      ':endDate': updates.endDate,
      ':currentValue': updates.currentValue,
      ':objectives': updates.objectives,
      ':startDateUtc': updates.startDateUtc,
      ':dueDateUtc': updates.dueDateUtc,
      ':finishAtUtc': updates.finishAtUtc,
    },
    ReturnValues: 'ALL_NEW' as const,
  };

  const result = await dynamoDB.send(new UpdateCommand(params));
  return { statusCode: 200, body: JSON.stringify(result.Attributes) };
}

function getQuarter(date: Date): string {
  const month = date.getMonth();
  const year = date.getFullYear();
  const quarter = Math.floor(month / 3) + 1;
  return `Q${quarter}-${year}`;
}

async function deleteStrategicTheme(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  if (!id) {
    throw new Error('Missing strategic theme ID');
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${id}`,
      SK: `STRATEGICTHEME#${id}`,
    },
  };

  await dynamoDB.send(new DeleteCommand(params));
  return { statusCode: 204, body: '' };
}