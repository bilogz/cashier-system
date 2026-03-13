<script setup lang="ts">
import Logo from '@/layouts/full/logo/LogoDark.vue';
import AuthLogin from './authForms/AuthLogin.vue';
</script>

<template>
  <v-row class="h-screen admin-login-shell" no-gutters>
    <!---Left Part-->
    <v-col cols="12" class="d-flex align-center login-panel">
      <v-container>
        <div class="pa-7 pa-sm-12 login-enter">
          <v-row justify="center">
            <v-col cols="12" lg="10" xl="6" md="7">
              <v-card elevation="0" class="loginBox saas-login-card">
                <v-card variant="outlined" class="saas-login-inner">
                  <v-card-text class="pa-9">
                    <!---Left Part Logo -->
                    <v-row>
                      <v-col cols="12" class="text-center">
                        <Logo />
                        <h2 class="text-primary text-h2 mt-8">Admin Login</h2>
                        <h4 class="text-h5 mt-3 login-subtitle">Sign in to the Cashier System dashboard</h4>
                      </v-col>
                    </v-row>
                    <!---Left Part Logo -->

                    <!---Left Part Form-->
                    <AuthLogin />
                    <!---Left Part Form-->
                  </v-card-text>
                </v-card>
              </v-card>
            </v-col>
          </v-row>
        </div>
      </v-container>
    </v-col>
    <!---Left Part-->
  </v-row>
</template>
<style lang="scss">
.admin-login-shell {
  background:
    radial-gradient(1200px 420px at 16% 8%, rgba(20, 101, 255, 0.14), transparent 50%),
    radial-gradient(900px 380px at 86% 90%, rgba(14, 176, 255, 0.12), transparent 52%),
    #eef3f9;
}

.login-panel {
  background: transparent;
}

.loginBox {
  max-width: 475px;
  margin: 0 auto;
}

.saas-login-card {
  border-radius: 18px;
  animation: cardRise 420ms ease-out;
}

.saas-login-inner {
  border-radius: 18px !important;
  border-color: rgba(25, 91, 194, 0.22) !important;
  background: linear-gradient(180deg, #ffffff 0%, #f6faff 100%);
  box-shadow: 0 14px 40px rgba(17, 63, 145, 0.12);
}

.login-subtitle {
  color: #4a5f85;
  font-weight: 500;
}

.login-enter {
  animation: fadeIn 360ms ease-out;
}

@keyframes cardRise {
  from {
    transform: translateY(10px) scale(0.99);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
