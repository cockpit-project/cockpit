import createHashHistory from 'history/lib/createHashHistory';
import useQueries from 'history/lib/useQueries';

if (!window.location.hash) { window.location.hash = '#/'; }

export default useQueries(createHashHistory)();
