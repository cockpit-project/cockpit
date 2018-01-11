import { call, put, takeEvery, takeLatest } from 'redux-saga/effects';
import {
  fetchRecipeInfoApi, fetchRecipeNamesApi, fetchRecipeContentsApi,
  deleteRecipeApi, setRecipeDescriptionApi,
  createRecipeApi,
} from '../apiCalls';
import {
  FETCHING_RECIPE, fetchingRecipeSucceeded,
  fetchingRecipesSucceeded,
  FETCHING_RECIPE_CONTENTS, fetchingRecipeContentsSucceeded,
  SET_RECIPE_DESCRIPTION,
  CREATING_RECIPE, creatingRecipeSucceeded,
  DELETING_RECIPE, deletingRecipeSucceeded,
  recipesFailure,
} from '../actions/recipes';

function* fetchRecipe(action) {
  const { recipeId } = action.payload;
  const response = yield call(fetchRecipeInfoApi, recipeId);
  yield put(fetchingRecipeSucceeded(response));
}

function* fetchRecipesFromName(recipeName) {
  const response = yield call(fetchRecipeInfoApi, recipeName);
  yield put(fetchingRecipesSucceeded(response));
}

function* fetchRecipes() {
  try {
    const recipeNames = yield call(fetchRecipeNamesApi);
    yield* recipeNames.map(recipeName => fetchRecipesFromName(recipeName));
  } catch (error) {
    console.log('errorloadRecipesSaga');
    yield put(recipesFailure(error));
  }
}

function* fetchRecipeContents(action) {
  try {
    const { recipeId } = action.payload;
    const response = yield call(fetchRecipeContentsApi, recipeId);
    yield put(fetchingRecipeContentsSucceeded(response));
  } catch (error) {
    console.log('Error in fetchRecipeContentsSaga');
    yield put(recipesFailure(error));
  }
}


function* setRecipeDescription(action) {
  try {
    const { recipe, description } = action.payload;
    yield call(setRecipeDescriptionApi, recipe, description);
  } catch (error) {
    console.log('Error in setRecipeDescription');
    yield put(recipesFailure(error));
  }
}

function* deleteRecipe(action) {
  try {
    const { recipeId } = action.payload;
    const response = yield call(deleteRecipeApi, recipeId);
    yield put(deletingRecipeSucceeded(response));
  } catch (error) {
    console.log('errorDeleteRecipesSaga');
    yield put(recipesFailure(error));
  }
}

function* createRecipe(action) {
  try {
    const { events, recipe } = action.payload;
    yield call(createRecipeApi, events, recipe);
    yield put(creatingRecipeSucceeded(recipe));
  } catch (error) {
    console.log('errorCreateRecipeSaga');
    yield put(recipesFailure(error));
  }
}

export default function* () {
  yield takeEvery(CREATING_RECIPE, createRecipe);
  yield takeEvery(FETCHING_RECIPE, fetchRecipe);
  yield takeLatest(FETCHING_RECIPE_CONTENTS, fetchRecipeContents);
  yield takeLatest(SET_RECIPE_DESCRIPTION, setRecipeDescription);
  yield takeEvery(DELETING_RECIPE, deleteRecipe);
  yield* fetchRecipes();
}
