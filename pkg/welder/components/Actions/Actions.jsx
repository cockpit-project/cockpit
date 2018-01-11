import React from 'react';
import PropTypes from 'prop-types';
import constants from '../../core/constants';
import utils from '../../core/utils';

class Actions extends React.Component {

  state = { actions: [] };


  componentDidMount() {
  }

  componentDidUpdate() {
  }

  componentWillUnmount() {
  }

  getComptypes() {
    const that = this;
    utils.apiFetch(constants.get_recipeactions_url)
      .then(data => {
        that.setState({ actions: data });
      })
      .catch(() => console.log('Error getting recipe actions: ${e}'));
  }


  render() {
    // const { Buttons } = this.props;
    // const { MenuItems } = this.props;
    const { className } = this.props;
    // const { actions } = this.props;

    return (
      <div className={className}>
        {this.state.actions.map((action, i) => {
          if (action.type === 'button') {
            return <button key={i} className="btn btn-default">{action.label}</button>;
          }

          return false;
        })}
        <div className="dropdown dropdown-kebab-pf pull-right">
          <button
            className="btn btn-link dropdown-toggle"
            type="button"
            id="dropdownKebab"
            data-toggle="dropdown"
            aria-haspopup="true"
            aria-expanded="true"
          >
            <span className="fa fa-ellipsis-v"></span>
          </button>
          <ul className="dropdown-menu dropdown-menu-right" aria-labelledby="dropdownKebab">
            {this.state.actions.map((action, i) => {
              if (action.type === 'menu') {
                return <li key={i}><a href="#">{action.label}</a></li>;
              }

              return false;
            })}
          </ul>
        </div>
      </div>
    );
  }
}

Actions.propTypes = {
  className: PropTypes.node,
};

export default Actions;
