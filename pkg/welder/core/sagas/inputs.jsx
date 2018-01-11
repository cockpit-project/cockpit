import { call, put, takeEvery } from 'redux-saga/effects';
import { fetchRecipeInputsApi } from '../apiCalls';
import { FETCHING_INPUTS, fetchingInputsSucceeded } from '../actions/inputs';

function updateInputComponentData(inputs, componentData) {
  let updatedInputs = inputs;
  if (componentData !== undefined && componentData.length > 0) {
    const parsedInputs = componentData.map(component => {
      const index = inputs[0].map(input => input.name).indexOf(component.name);
      if (index >= 0) {
        inputs[0][index].inRecipe = true; // eslint-disable-line no-param-reassign
        inputs[0][index].user_selected = true; // eslint-disable-line no-param-reassign
        inputs[0][index].version_selected = component.version; // eslint-disable-line no-param-reassign
        inputs[0][index].release_selected = component.release; // eslint-disable-line no-param-reassign
      }
      return inputs;
    });
    updatedInputs = parsedInputs[0];
  }
  return updatedInputs;
}

function* fetchInputs(action) {
  try {
    const { filter, selectedInputPage, pageSize, componentData } = action.payload;
    const response = yield call(fetchRecipeInputsApi, `/*${filter.value}*`, selectedInputPage, pageSize);
    const updatedResponse = yield call(updateInputComponentData, response, componentData);
    yield put(fetchingInputsSucceeded(filter, selectedInputPage, pageSize, updatedResponse));
  } catch (error) {
    console.log('Error in fetchInputsSaga');
  }
}

export default function* () {
  yield takeEvery(FETCHING_INPUTS, fetchInputs);
}
