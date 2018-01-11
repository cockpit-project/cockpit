export const FETCHING_INPUTS = 'FETCHING_INPUTS';
export const fetchingInputs = (filter, selectedInputPage, pageSize, componentData) => ({
  type: FETCHING_INPUTS,
  payload: {
    filter,
    selectedInputPage,
    pageSize,
    componentData,
  },
});

export const FETCHING_INPUTS_SUCCEEDED = 'FETCHING_INPUTS_SUCCEEDED';
export const fetchingInputsSucceeded = (filter, selectedInputPage, pageSize, inputs) => ({
  type: FETCHING_INPUTS_SUCCEEDED,
  payload: {
    filter,
    selectedInputPage,
    pageSize,
    inputs,
  },
});

export const SET_INPUT_COMPONENTS = 'SET_INPUT_COMPONENTS';
export const setInputComponents = (inputComponents) => ({
  type: SET_INPUT_COMPONENTS,
  payload: {
    inputComponents,
  },
});

export const SET_FILTERED_INPUT_INPUTS = 'SET_FILTERED_INPUT_INPUTS';
export const setFilteredInputInputs = (filteredInputInputs) => ({
  type: SET_FILTERED_INPUT_INPUTS,
  payload: {
    filteredInputInputs,
  },
});

export const SET_SELECTED_INPUT_PAGE = 'SET_SELECTED_INPUT_PAGE';
export const setSelectedInputPage = (selectedInputPage) => ({
  type: SET_SELECTED_INPUT_PAGE,
  payload: {
    selectedInputPage,
  },
});

export const SET_SELECTED_INPUT = 'SET_SELECTED_INPUT';
export const setSelectedInput = (selectedInput) => ({
  type: SET_SELECTED_INPUT,
  payload: {
    selectedInput,
  },
});

export const SET_SELECTED_INPUT_STATUS = 'SET_SELECTED_INPUT_STATUS';
export const setSelectedInputStatus = (selectedInputStatus) => ({
  type: SET_SELECTED_INPUT_STATUS,
  payload: {
    selectedInputStatus,
  },
});

export const SET_SELECTED_INPUT_PARENT = 'SET_SELECTED_INPUT_PARENT';
export const setSelectedInputParent = (selectedInputParent) => ({
  type: SET_SELECTED_INPUT_PARENT,
  payload: {
    selectedInputParent,
  },
});

export const DELETE_FILTER = 'DELETE_FILTER';
export const deleteFilter = () => ({
  type: DELETE_FILTER,
});
