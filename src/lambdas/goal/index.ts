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

interface Goal {
  id: string;
  keyResultId: string;
  objectiveId: string;
  strategicThemeId: string;
  description: string;
  startDate: string;
  endDate: string;
  currentValue: number;
  targetValue: number;
  upperTarget: number;
  lowerTarget: number;
  isAutomatic: boolean;
  assignedTo: string;
  assigneeType: 'PERSON' | 'TEAM';
  parentGoalId?: string;
  childGoals: string[];
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
          return await getAllGoals(event);
        } else {
          return await getGoal(event);
        }
      case 'POST':
        return await createGoal(event);
      case 'PUT':
        return await updateGoal(event);
      case 'DELETE':
        return await deleteGoal(event);
      default:
        return { statusCode: 400, body: JSON.stringify({ message: 'Unsupported HTTP method' }) };
    }
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ message: 'Internal server error' }) };
  }
};

async function getGoal(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  const keyResultId = event.queryStringParameters?.keyResultId;
  const objectiveId = event.queryStringParameters?.objectiveId;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (id && keyResultId && objectiveId && strategicThemeId) {
    const params = {
      TableName: TABLE_NAME,
      Key: {
        PK: `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}#KEYRESULT#${keyResultId}`,
        SK: `GOAL#${id}`,
      },
    };

    const result = await dynamoDB.send(new GetCommand(params));
    if (result.Item) {
      return { statusCode: 200, body: JSON.stringify(result.Item) };
    } else {
      return { statusCode: 404, body: JSON.stringify({ message: 'Goal not found' }) };
    }
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing required parameters' }) };
  }
}

async function getAllGoals(event: APIGatewayProxyEvent) {
  const keyResultId = event.queryStringParameters?.keyResultId;
  const objectiveId = event.queryStringParameters?.objectiveId;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (keyResultId && objectiveId && strategicThemeId) {
    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}#KEYRESULT#${keyResultId}`,
        ':sk': 'GOAL#',
      },
    };

    const result = await dynamoDB.send(new QueryCommand(params));
    return { statusCode: 200, body: JSON.stringify(result.Items) };
  } else {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing required parameters' }) };
  }
}

async function createGoal(event: APIGatewayProxyEvent) {
  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body' }) };
  }
  const goal: Goal = JSON.parse(event.body as string);
  goal.id = uuidv4();
  goal.creationDateUtc = new Date().toISOString();

  const params = {
    TableName: TABLE_NAME,
    Item: {
      PK: `STRATEGICTHEME#${goal.strategicThemeId}#OBJECTIVE#${goal.objectiveId}#KEYRESULT#${goal.keyResultId}`,
      SK: `GOAL#${goal.id}`,
      GSI1PK: 'GOAL',
      GSI1SK: goal.startDate,
      GSI2PK: 'GOAL',
      GSI2SK: goal.endDate,
      ...goal,
    },
  };

  await dynamoDB.send(new PutCommand(params));

  // If this goal has a parent, update the parent's childGoals array
  if (goal.parentGoalId) {
    await updateParentGoal(goal.parentGoalId, goal.id, 'add');
  }

  return { statusCode: 201, body: JSON.stringify(goal) };
}

async function updateGoal(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  if (!id || !event.body) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body or missing id' }) };
  }
  const updates: Partial<Omit<Goal, 'id'>> = JSON.parse(event.body as string);

  // Type guard to ensure required properties exist
  if (!updates.strategicThemeId || !updates.objectiveId || !updates.keyResultId) {
    return { 
      statusCode: 400, 
      body: JSON.stringify({ 
        message: 'Missing required fields: strategicThemeId, objectiveId, or keyResultId' 
      }) 
    };
  }

  const params: UpdateCommandInput = {
    ReturnValues: ReturnValue.ALL_NEW as ReturnValue,
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${updates.strategicThemeId}#OBJECTIVE#${updates.objectiveId}#KEYRESULT#${updates.keyResultId}`,
      SK: `GOAL#${id}`,
    },
    UpdateExpression: 'set description = :description, startDate = :startDate, endDate = :endDate, currentValue = :currentValue, targetValue = :targetValue, upperTarget = :upperTarget, lowerTarget = :lowerTarget, isAutomatic = :isAutomatic, assignedTo = :assignedTo, assigneeType = :assigneeType, parentGoalId = :parentGoalId, childGoals = :childGoals, startDateUtc = :startDateUtc, dueDateUtc = :dueDateUtc, finishAtUtc = :finishAtUtc',
    ExpressionAttributeValues: {
      ':description': updates.description ?? undefined,
      ':startDate': updates.startDate ?? undefined,
      ':endDate': updates.endDate ?? undefined,
      ':currentValue': updates.currentValue ?? undefined,
      ':targetValue': updates.targetValue ?? undefined,
      ':upperTarget': updates.upperTarget ?? undefined,
      ':lowerTarget': updates.lowerTarget ?? undefined,
      ':isAutomatic': updates.isAutomatic ?? undefined,
      ':assignedTo': updates.assignedTo ?? undefined,
      ':assigneeType': updates.assigneeType ?? undefined,
      ':parentGoalId': updates.parentGoalId ?? undefined,
      ':childGoals': updates.childGoals ?? undefined,
      ':startDateUtc': updates.startDateUtc ?? undefined,
      ':dueDateUtc': updates.dueDateUtc ?? undefined,
      ':finishAtUtc': updates.finishAtUtc ?? undefined,
    },
    // ReturnValues is set at the top of the params object
  };

  const result = await dynamoDB.send(new UpdateCommand(params));

  // Handle changes in parent-child relationships
  if (result.Attributes) {
    const oldGoal = await getGoalById(id, updates);
    if (oldGoal && oldGoal.parentGoalId !== updates.parentGoalId) {
      if (oldGoal.parentGoalId) {
        await updateParentGoal(oldGoal.parentGoalId, id, 'remove');
      }
      if (updates.parentGoalId) {
        await updateParentGoal(updates.parentGoalId, id, 'add');
      }
    }

    // Propagate current value changes up the hierarchy
    await propagateValueChanges(updates.strategicThemeId, updates.objectiveId, updates.keyResultId, updates.parentGoalId);
  }

  return { statusCode: 200, body: JSON.stringify(result.Attributes) };
}

async function propagateValueChanges(strategicThemeId: string, objectiveId: string, keyResultId: string, parentGoalId: string | undefined) {
  // Update parent goal if exists
  if (parentGoalId) {
    await updateParentGoalValue(parentGoalId);
  }

  // Update key result
  await updateKeyResultValue(strategicThemeId, objectiveId, keyResultId);

  // Update objective
  await updateObjectiveValue(strategicThemeId, objectiveId);

  // Update strategic theme
  await updateStrategicThemeValue(strategicThemeId);
}

async function updateParentGoalValue(parentGoalId: string) {
  const parentGoal = await getGoalById(parentGoalId);
  if (!parentGoal) return;

  const childGoals = await Promise.all(parentGoal.childGoals.map(childId => getGoalById(childId)));
  const currentValue = childGoals.reduce((sum, goal) => sum + (goal?.currentValue || 0), 0) / childGoals.length;

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${parentGoal.strategicThemeId}#OBJECTIVE#${parentGoal.objectiveId}#KEYRESULT#${parentGoal.keyResultId}`,
      SK: `GOAL#${parentGoalId}`,
    },
    UpdateExpression: 'SET currentValue = :currentValue',
    ExpressionAttributeValues: {
      ':currentValue': currentValue,
    },
  }));

  // Recursively update parent goals
  if (parentGoal.parentGoalId) {
    await updateParentGoalValue(parentGoal.parentGoalId);
  }
}

async function updateKeyResultValue(strategicThemeId: string, objectiveId: string, keyResultId: string) {
  const goals = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}#KEYRESULT#${keyResultId}`,
      ':sk': 'GOAL#',
    },
  }));

  const currentValue = goals.Items
    ? goals.Items.reduce((sum, goal) => sum + (goal.currentValue || 0), 0) / goals.Items.length
    : 0;

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}`,
      SK: `KEYRESULT#${keyResultId}`,
    },
    UpdateExpression: 'SET currentValue = :currentValue',
    ExpressionAttributeValues: {
      ':currentValue': currentValue,
    },
  }));
}

async function updateObjectiveValue(strategicThemeId: string, objectiveId: string) {
  const keyResults = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}`,
      ':sk': 'KEYRESULT#',
    },
  }));

  const currentValue = keyResults.Items
    ? keyResults.Items.reduce((sum, kr) => sum + (kr.currentValue || 0), 0) / keyResults.Items.length
    : 0;

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${strategicThemeId}`,
      SK: `OBJECTIVE#${objectiveId}`,
    },
    UpdateExpression: 'SET currentValue = :currentValue',
    ExpressionAttributeValues: {
      ':currentValue': currentValue,
    },
  }));
}

async function updateStrategicThemeValue(strategicThemeId: string) {
  const objectives = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `STRATEGICTHEME#${strategicThemeId}`,
      ':sk': 'OBJECTIVE#',
    },
  }));

  const currentValue = objectives.Items
    ? objectives.Items.reduce((sum, obj) => sum + (obj.currentValue || 0), 0) / objectives.Items.length
    : 0;

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${strategicThemeId}`,
      SK: `STRATEGICTHEME#${strategicThemeId}`,
    },
    UpdateExpression: 'SET currentValue = :currentValue',
    ExpressionAttributeValues: {
      ':currentValue': currentValue,
    },
  }));
}

async function deleteGoal(event: APIGatewayProxyEvent) {
  const id = event.pathParameters?.id;
  const keyResultId = event.queryStringParameters?.keyResultId;
  const objectiveId = event.queryStringParameters?.objectiveId;
  const strategicThemeId = event.queryStringParameters?.strategicThemeId;

  if (!id || !keyResultId || !objectiveId || !strategicThemeId) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing required parameters' }) };
  }

  // Get the goal before deleting it
  const goal = await getGoalById(id, { keyResultId, objectiveId, strategicThemeId });

  if (!goal) {
    return { statusCode: 404, body: JSON.stringify({ message: 'Goal not found' }) };
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${strategicThemeId}#OBJECTIVE#${objectiveId}#KEYRESULT#${keyResultId}`,
      SK: `GOAL#${id}`,
    },
  };

  await dynamoDB.send(new DeleteCommand(params));

  // If this goal had a parent, update the parent's childGoals array
  if (goal.parentGoalId) {
    await updateParentGoal(goal.parentGoalId, id, 'remove');
  }

  // If this goal had children, update their parentGoalId to null
  if (goal.childGoals && goal.childGoals.length > 0) {
    for (const childId of goal.childGoals) {
      await updateChildGoal(childId, null);
    }
  }

  return { statusCode: 204, body: '' };
}

async function updateParentGoal(parentId: string, childId: string, action: 'add' | 'remove') {
  const parentGoal = await getGoalById(parentId);
  if (!parentGoal) return;

  const updatedChildGoals = action === 'add'
    ? [...(parentGoal.childGoals || []), childId]
    : (parentGoal.childGoals || []).filter(id => id !== childId);

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${parentGoal.strategicThemeId}#OBJECTIVE#${parentGoal.objectiveId}#KEYRESULT#${parentGoal.keyResultId}`,
      SK: `GOAL#${parentId}`,
    },
    UpdateExpression: 'SET childGoals = :childGoals',
    ExpressionAttributeValues: {
      ':childGoals': updatedChildGoals,
    },
  }));
}

async function updateChildGoal(childId: string, parentId: string | null) {
  const childGoal = await getGoalById(childId);
  if (!childGoal) return;

  await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${childGoal.strategicThemeId}#OBJECTIVE#${childGoal.objectiveId}#KEYRESULT#${childGoal.keyResultId}`,
      SK: `GOAL#${childId}`,
    },
    UpdateExpression: 'SET parentGoalId = :parentId',
    ExpressionAttributeValues: {
      ':parentId': parentId,
    },
  }));
}

async function getGoalById(id: string, context?: Partial<Goal>): Promise<Goal | null> {
  if (!context || !context.strategicThemeId || !context.objectiveId || !context.keyResultId) {
    // If context is not provided, query the GSI to find the goal
    const queryParams = {
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': 'GOAL',
        ':sk': `GOAL#${id}`,
      },
    };

    const result = await dynamoDB.send(new QueryCommand(queryParams));
    return result.Items && result.Items.length > 0 ? result.Items[0] as Goal : null;
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `STRATEGICTHEME#${context.strategicThemeId}#OBJECTIVE#${context.objectiveId}#KEYRESULT#${context.keyResultId}`,
      SK: `GOAL#${id}`,
    },
  };

  const result = await dynamoDB.send(new GetCommand(params));
  return result.Item as Goal | null;
}