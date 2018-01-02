function states(state = [], action) {
  switch (action.type) {
    case 'COUNT':
      return [...state, {
        count: (state.count || 0) + 1,
      }];
    default:
      return state;
  }
}

export default states;
