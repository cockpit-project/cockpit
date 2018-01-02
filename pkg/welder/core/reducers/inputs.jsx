import {
  FETCHING_INPUTS_SUCCEEDED,
  SET_SELECTED_INPUT_PAGE,
  SET_SELECTED_INPUT, SET_SELECTED_INPUT_STATUS, SET_SELECTED_INPUT_PARENT,
  SET_INPUT_COMPONENTS, SET_FILTERED_INPUT_COMPONENTS,
  DELETE_FILTER,
} from '../actions/inputs';

const inputs = (state = [], action) => {
  switch (action.type) {
    case SET_INPUT_COMPONENTS:
      return Object.assign({}, state,
                           { inputComponents: action.payload.inputComponents });
    case FETCHING_INPUTS_SUCCEEDED:
      return Object.assign(
          {}, state,
          {
              inputFilters: action.payload.filter,
              inputComponents: action.payload.selectedInputPage > 0
              ? state.inputComponents.slice(0, action.payload.selectedInputPage)
              .concat([action.payload.inputs[0]].concat(Array(
                  Math.ceil((action.payload.inputs[1] / action.payload.pageSize) - 1) -
                             action.payload.selectedInputPage).fill([])))
              : [action.payload.inputs[0]].concat(Array(
                  Math.ceil((action.payload.inputs[1] / action.payload.pageSize) - 1)).fill([])),
              totalInputs: action.payload.inputs[1],
              pageSize: action.payload.pageSize,
          });
    case SET_FILTERED_INPUT_COMPONENTS:
      return Object.assign(
          {}, state,
          { filteredInputComponents: action.payload.filteredInputComponents }
      );
    case SET_SELECTED_INPUT_PAGE:
      return Object.assign(
          {}, state,
          { selectedInputPage: action.payload.selectedInputPage }
      );
    case SET_SELECTED_INPUT:
      return Object.assign(
          {}, state,
          { selectedInput: Object.assign({}, state.selectedInput, { component: action.payload.selectedInput }) }
      );
    case SET_SELECTED_INPUT_STATUS:
      return Object.assign(
          {}, state,
          { selectedInput: Object.assign({}, state.selectedInput, { status: action.payload.selectedInputStatus }) }
      );
    case SET_SELECTED_INPUT_PARENT:
      return Object.assign(
          {}, state,
          { selectedInput: Object.assign({}, state.selectedInput, { parent: action.payload.selectedInputParent }) }
      );
    case DELETE_FILTER:
      return Object.assign(
          {}, state,
          {
              filteredInputComponents: [[]],
              totalFilteredInputs: 0,
              selectedInputPage: 0,
              inputFilters: {
                  field: 'name',
                  value: '',
              },
          }
      );
    default:
      return state;
  }
};

export default inputs;
