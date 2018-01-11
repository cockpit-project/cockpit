export const SET_EDIT_DESCRIPTION_VISIBLE = 'SET_EDIT_DESCRIPTION_VISIBLE';
export const setEditDescriptionVisible = (visible) => ({
  type: SET_EDIT_DESCRIPTION_VISIBLE,
  payload: {
    visible,
  },
});

export const SET_EDIT_DESCRIPTION_VALUE = 'SET_EDIT_DESCRIPTION_VALUE';
export const setEditDescriptionValue = (value) => ({
  type: SET_EDIT_DESCRIPTION_VALUE,
  payload: {
    value,
  },
});

export const SET_ACTIVE_TAB = 'SET_ACTIVE_TAB';
export const setActiveTab = (activeTab) => ({
  type: SET_ACTIVE_TAB,
  payload: {
    activeTab,
  },
});

export const SET_SELECTED_COMPONENT = 'SET_SELECTED_COMPONENT';
export const setSelectedComponent = (component) => ({
  type: SET_SELECTED_COMPONENT,
  payload: {
    component,
  },
});

export const SET_SELECTED_COMPONENT_PARENT = 'SET_SELECTED_COMPONENT_PARENT';
export const setSelectedComponentParent = (componentParent) => ({
  type: SET_SELECTED_COMPONENT_PARENT,
  payload: {
    componentParent,
  },
});

export const SET_SELECTED_COMPONENT_STATUS = 'SET_SELECTED_COMPONENT_STATUS';
export const setSelectedComponentStatus = (componentStatus) => ({
  type: SET_SELECTED_COMPONENT_STATUS,
  payload: {
    componentStatus,
  },
});
