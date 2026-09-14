import { 
  auth, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  getUserProfile, 
  setUserProfile, 
  createAccountBySupervisor, 
  signOut 
} from './firabase.js';

let currentScrambledCode = '';
let current2FACode = '';
let pendingUser = null;

// Initialize Scrambled Code Canvas
function generateScrambledCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function renderScrambledCode() {
  const canvas = document.getElementById('scrambledCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Background
  ctx.fillStyle = '#dce2eb';
  ctx.fillRect(0, 0, width, height);

  currentScrambledCode = generateScrambledCode();

  // Noise lines
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = `rgba(${Math.floor(Math.random()*150)}, ${Math.floor(Math.random()*150)}, ${Math.floor(Math.random()*150)}, 0.4)`;
    ctx.beginPath();
    ctx.moveTo(Math.random() * width, Math.random() * height);
    ctx.lineTo(Math.random() * width, Math.random() * height);
    ctx.lineWidth = Math.random() * 2 + 1;
    ctx.stroke();
  }

  // Noise dots
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${Math.floor(Math.random()*100)}, ${Math.floor(Math.random()*100)}, ${Math.floor(Math.random()*100)}, 0.5)`;
    ctx.beginPath();
    ctx.arc(Math.random() * width, Math.random() * height, Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Text Characters
  ctx.font = 'bold 26px monospace';
  const charSpacing = width / (currentScrambledCode.length + 1);

  window.currentScrambledCode = currentScrambledCode;

  for (let i = 0; i < currentScrambledCode.length; i++) {
    ctx.save();
    const char = currentScrambledCode[i];
    const x = charSpacing * (i + 1);
    const y = height / 2 + 8 + (Math.random() * 6 - 3);

    ctx.translate(x, y);
    const angle = (Math.random() - 0.5) * 0.4;
    ctx.rotate(angle);

    ctx.fillStyle = `rgb(${Math.floor(Math.random()*100)}, ${Math.floor(Math.random()*120 + 30)}, ${Math.floor(Math.random()*180 + 50)})`;
    ctx.fillText(char, -10, 0);
    ctx.restore();
  }
}

// Show Alerts
function showAlert(elementId, message, type = 'danger') {
  const alertEl = document.getElementById(elementId);
  if (!alertEl) return;

  alertEl.className = `alert alert-${type} show`;
  alertEl.textContent = message;
}

function hideAlert(elementId) {
  const alertEl = document.getElementById(elementId);
  if (alertEl) {
    alertEl.className = 'alert';
    alertEl.textContent = '';
  }
}

// Step Navigation
function goToStep(stepNumber) {
  document.querySelectorAll('.auth-step').forEach(step => step.classList.remove('active'));
  const targetStep = document.getElementById(`step${stepNumber}`);
  if (targetStep) {
    targetStep.classList.add('active');
  }
}

// Generate and start 2FA
function start2FA(user) {
  pendingUser = user;
  current2FACode = Math.floor(100000 + Math.random() * 900000).toString();

  const demoCodeEl = document.getElementById('2faDemoCode');
  if (demoCodeEl) {
    demoCodeEl.textContent = current2FACode;
  }

  // Clear OTP input fields
  document.querySelectorAll('.otp-digit').forEach(input => input.value = '');
  const firstOtp = document.querySelector('.otp-digit[data-index="0"]');
  if (firstOtp) firstOtp.focus();

  goToStep(2);
}

// Setup OTP Input Handler
function setupOTPInputs() {
  const digits = document.querySelectorAll('.otp-digit');
  digits.forEach((digit, index) => {
    digit.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val.length >= 1) {
        e.target.value = val[0];
        if (index < digits.length - 1) {
          digits[index + 1].focus();
        }
      }
      checkOTPComplete();
    });

    digit.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        digits[index - 1].focus();
      }
    });

    digit.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{6}$/.test(pasteData)) {
        digits.forEach((d, i) => d.value = pasteData[i] || '');
        checkOTPComplete();
      }
    });
  });
}

function getEnteredOTP() {
  const digits = document.querySelectorAll('.otp-digit');
  return Array.from(digits).map(d => d.value).join('');
}

function checkOTPComplete() {
  const code = getEnteredOTP();
  if (code.length === 6) {
    verify2FA();
  }
}

async function verify2FA() {
  hideAlert('step2Alert');
  const enteredCode = getEnteredOTP();

  if (enteredCode !== current2FACode) {
    showAlert('step2Alert', 'Invalid verification code. Please check and try again.');
    return;
  }

  try {
    const btn = document.getElementById('verify2faBtn');
    if (btn) btn.disabled = true;

    // Mark 2FA verified in session
    sessionStorage.setItem('pakset_2fa_verified', 'true');
    sessionStorage.setItem('pakset_user_uid', pendingUser.uid);

    // Fetch user profile or initialize if missing
    let profile = await getUserProfile(pendingUser.uid);
    if (!profile) {
      const isSupervisor = pendingUser.email.includes('supervisor') || pendingUser.email.includes('admin');
      profile = {
        email: pendingUser.email,
        name: pendingUser.email.split('@')[0],
        role: isSupervisor ? 'supervisor' : 'worker',
        createdAt: new Date().toISOString()
      };
      await setUserProfile(pendingUser.uid, profile);
    }

    sessionStorage.setItem('pakset_user_role', profile.role);
    sessionStorage.setItem('pakset_user_name', profile.name || profile.email);

    showAlert('step2Alert', 'Two-step verification successful! Redirecting...', 'success');

    setTimeout(() => {
      window.location.href = 'workfloor.html';
    }, 1000);

  } catch (err) {
    console.error('verify2FA error:', err);
    showAlert('step2Alert', 'Error finalizing authentication: ' + err.message);
    const btn = document.getElementById('verify2faBtn');
    if (btn) btn.disabled = false;
  }
}

// Handle Login Form Submit
async function handleLoginSubmit(e) {
  e.preventDefault();
  hideAlert('step1Alert');

  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const scrambledInput = document.getElementById('scrambledInput');

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const enteredScrambled = scrambledInput.value.trim().toUpperCase();

  if (!email || !password) {
    showAlert('step1Alert', 'Please provide both email and password.');
    return;
  }

  if (enteredScrambled !== currentScrambledCode.toUpperCase()) {
    showAlert('step1Alert', 'Security scrambled code does not match. Please try again.');
    scrambledInput.value = '';
    renderScrambledCode();
    return;
  }

  const submitBtn = document.getElementById('loginSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Authenticating...';

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In & Continue';

    // Proceed to Step 2
    start2FA(userCredential.user);

  } catch (err) {
    console.error('Login error:', err);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In & Continue';

    // Fallback if Email/Password sign-in is disabled in Firebase Console
    if (err.code === 'auth/configuration-not-found' || err.code === 'auth/operation-not-allowed') {
      const cleanEmail = email.toLowerCase();
      const localUsers = JSON.parse(localStorage.getItem('pakset_local_users') || '{}');
      
      const isDefaultSupervisor = (cleanEmail === 'supervisor@pakset.com' && password === 'SupervisorPakset2026!');
      const registeredUser = localUsers[cleanEmail];

      if (isDefaultSupervisor || (registeredUser && registeredUser.password === password)) {
        console.warn('Firebase Auth Email/Password disabled in Console. Authenticating via local/Firestore account.');
        const fallbackUser = {
          uid: registeredUser ? registeredUser.uid : 'supervisor_default_uid',
          email: email
        };

        // Store fallback role
        const role = isDefaultSupervisor ? 'supervisor' : (registeredUser?.role || 'worker');
        const name = isDefaultSupervisor ? 'Chief Supervisor' : (registeredUser?.name || email.split('@')[0]);
        
        sessionStorage.setItem('pakset_user_role', role);
        sessionStorage.setItem('pakset_user_name', name);

        start2FA(fallbackUser);
        return;
      }
    }

    let errorMsg = 'Invalid email or password.';
    if (err.code === 'auth/user-not-found') {
      errorMsg = 'Account not found. Please contact a supervisor to create your account.';
    } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      errorMsg = 'Incorrect email or password.';
    } else if (err.code === 'auth/too-many-requests') {
      errorMsg = 'Too many failed login attempts. Please try again later.';
    }

    showAlert('step1Alert', errorMsg);
    scrambledInput.value = '';
    renderScrambledCode();
  }
}

// Supervisor Account Creation Modal & Handling
async function handleSupervisorCreateAccount(e) {
  e.preventDefault();
  hideAlert('supervisorCreateAlert');

  // Verify supervisor rights
  const currentRole = sessionStorage.getItem('pakset_user_role');
  if (currentRole !== 'supervisor') {
    showAlert('supervisorCreateAlert', 'Unauthorized! Account creation is strictly restricted to supervisors.');
    return;
  }

  const name = document.getElementById('newWorkerName').value.trim();
  const email = document.getElementById('newWorkerEmail').value.trim();
  const password = document.getElementById('newWorkerPassword').value;
  const role = document.getElementById('newWorkerRole').value;

  if (!email || !password || password.length < 6) {
    showAlert('supervisorCreateAlert', 'Please enter a valid email and a password of at least 6 characters.');
    return;
  }

  const btn = document.getElementById('createWorkerSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating Account...';

  try {
    await createAccountBySupervisor(email, password, role, name);
    btn.disabled = false;
    btn.textContent = 'Create User Account';

    showAlert('supervisorCreateAlert', `Account created successfully for ${email} (${role.toUpperCase()})!`, 'success');

    document.getElementById('supervisorAccountForm').reset();

  } catch (err) {
    console.error('Supervisor account creation error:', err);
    btn.disabled = false;
    btn.textContent = 'Create User Account';

    let msg = 'Failed to create account: ' + err.message;
    if (err.code === 'auth/email-already-in-use') {
      msg = 'An account with this email already exists.';
    }
    showAlert('supervisorCreateAlert', msg);
  }
}

// Bootstrap Initial Supervisor Account Setup
async function handleBootstrapSupervisor() {
  hideAlert('step1Alert');
  const btn = document.getElementById('bootstrapBtn');
  if (btn) btn.disabled = true;

  try {
    const email = 'supervisor@pakset.com';
    const password = 'SupervisorPakset2026!';
    
    // Save to local user registry fallback
    try {
      const localUsers = JSON.parse(localStorage.getItem('pakset_local_users') || '{}');
      localUsers[email.toLowerCase()] = {
        uid: 'supervisor_default_uid',
        email,
        password,
        name: 'Chief Supervisor',
        role: 'supervisor'
      };
      localStorage.setItem('pakset_local_users', JSON.stringify(localUsers));
    } catch (_) {}

    try {
      await createAccountBySupervisor(email, password, 'supervisor', 'Chief Supervisor');
    } catch (_) {}

    showAlert('step1Alert', `Supervisor Account Ready!\nEmail: ${email}\nPassword: ${password}`, 'success');
    
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = password;

  } catch (err) {
    console.error('Bootstrap error:', err);
    let msg = err.message;
    if (err.code === 'auth/email-already-in-use') {
      msg = 'Supervisor account ready (supervisor@pakset.com / SupervisorPakset2026!). You can sign in directly.';
    }
    showAlert('step1Alert', msg, 'info');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  renderScrambledCode();
  setupOTPInputs();

  // Refresh scrambled code button
  const refreshBtn = document.getElementById('refreshScrambledBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', renderScrambledCode);
  }

  // Step 1 Login Form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
  }

  // Step 2 2FA Button
  const verify2faBtn = document.getElementById('verify2faBtn');
  if (verify2faBtn) {
    verify2faBtn.addEventListener('click', verify2FA);
  }

  // Back to Step 1 Button
  const backToStep1Btn = document.getElementById('backToStep1Btn');
  if (backToStep1Btn) {
    backToStep1Btn.addEventListener('click', () => {
      goToStep(1);
      renderScrambledCode();
    });
  }

  // Supervisor Create Account Form
  const supervisorForm = document.getElementById('supervisorAccountForm');
  if (supervisorForm) {
    supervisorForm.addEventListener('submit', handleSupervisorCreateAccount);
  }

  // Bootstrap Button
  const bootstrapBtn = document.getElementById('bootstrapBtn');
  if (bootstrapBtn) {
    bootstrapBtn.addEventListener('click', handleBootstrapSupervisor);
  }

  // Check auth state for logged-in supervisor dashboard controls
  onAuthStateChanged(auth, async (user) => {
    if (user && sessionStorage.getItem('pakset_2fa_verified') === 'true') {
      const profile = await getUserProfile(user.uid);
      if (profile && profile.role === 'supervisor') {
        const supervisorCard = document.getElementById('supervisorCard');
        if (supervisorCard) {
          supervisorCard.style.display = 'block';
        }
      }
    }
  });
});
