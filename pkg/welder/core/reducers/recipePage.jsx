import {
  SET_EDIT_DESCRIPTION_VISIBLE, SET_EDIT_DESCRIPTION_VALUE,
  SET_SELECTED_COMPONENT, SET_SELECTED_COMPONENT_PARENT, SET_SELECTED_COMPONENT_STATUS,
  SET_ACTIVE_TAB,
} from '../actions/recipePage';

const recipePage = (state = [], action) => {
  switch (action.type) {
    case SET_EDIT_DESCRIPTION_VISIBLE:
      return Object.assign({}, state,
                           { editDescriptionVisible: action.payload.visible });
    case SET_EDIT_DESCRIPTION_VALUE:
      return Object.assign({}, state,
                           { editDescriptionValue: action.payload.value });
    case SET_SELECTED_COMPONENT:
      return Object.assign({}, state,
                           { selectedComponent: action.payload.component });
    case SET_SELECTED_COMPONENT_PARENT:
      return Object.assign({}, state,
                           { selectedComponentParent: action.payload.componentParent });
    case SET_SELECTED_COMPONENT_STATUS:
      return Object.assign({}, state,
                           { selectedComponentStatus: action.payload.componentStatus });
    case SET_ACTIVE_TAB:
      return Object.assign({}, state,
                           { activeTab: action.payload.activeTab });
    default:
      return state;
  }
};

export default recipePage;
