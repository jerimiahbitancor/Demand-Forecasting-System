import Swal from 'sweetalert2';
import './swalTheme.css';

// reverseButtons: SweetAlert2's default DOM order is confirm, deny, cancel,
// which paints the confirm on the LEFT and the cancel on the RIGHT. Reversed,
// every dialog reads Cancel (left) -> Confirm (right), and a deny button sits
// between them.
const ThemedSwal = Swal.mixin({
  buttonsStyling: true,
  reverseButtons: true
});

export default ThemedSwal;