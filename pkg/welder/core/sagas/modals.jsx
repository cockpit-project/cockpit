import { call, put, takeEvery } from 'redux-saga/effects';
import { fetchRecipeContentsApi, fetchModalCreateCompositionTypesApi } from '../apiCalls';

import {
   FETCHING_MODAL_EXPORT_RECIPE_CONTENTS, setModalExportRecipeContents,
   fetchingModalCreateCompositionTypesSuccess,
} from '../actions/modals';

function* fetchModalRecipeContents(action) {
  try {
    const { recipeName } = action.payload;
    const response = yield call(fetchRecipeContentsApi, recipeName);
    yield put(setModalExportRecipeContents(response.dependencies));
  } catch (error) {
    console.log('Error in loadModalRecipeSaga');
  }
}

function* fetchModalCreateCompositionTypes() {
  try {
    const response = yield call(fetchModalCreateCompositionTypesApi);
    yield put(fetchingModalCreateCompositionTypesSuccess(response));
  } catch (error) {
    console.log('Error in loadModalRecipeSaga');
  }
}

export default function* () {
  yield takeEvery(FETCHING_MODAL_EXPORT_RECIPE_CONTENTS, fetchModalRecipeContents);
  yield* fetchModalCreateCompositionTypes();
}
