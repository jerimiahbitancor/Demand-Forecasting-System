import Swal from 'sweetalert2';
import './swalTheme.css';

const ThemedSwal = Swal.mixin({
  buttonsStyling: true
});

export default ThemedSwal;