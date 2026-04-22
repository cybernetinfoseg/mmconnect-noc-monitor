import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, LogOut } from 'lucide-react';
import UserProfileForm from '../components/auth/UserProfileForm';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export default function CompletarPerfil() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await base44.auth.me();
        if (!currentUser) {
          base44.auth.redirectToLogin();
          return;
        }
        
        // Se usuário já preencheu perfil, redireciona para home
        if (!currentUser.primeiroAcesso) {
          navigate('/');
          return;
        }
        
        setUser(currentUser);
      } catch (error) {
        console.error('Erro:', error);
        base44.auth.redirectToLogin();
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [navigate]);

  const handleProfileSuccess = () => {
    setSubmitted(true);
    // Pequena pausa para mostrar mensagem de sucesso, depois recarrega
    setTimeout(() => {
      window.location.replace('/');
    }, 1500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 flex items-center justify-center p-4">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="p-5 bg-emerald-100 rounded-full animate-pulse">
              <CheckCircle className="h-12 w-12 text-emerald-600" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">Perfil Preenchido!</h1>
            <p className="text-slate-500">Redirecionando para análise de aprovação...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-4">
      <div className="max-w-2xl w-full mx-auto py-8">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-5 bg-amber-100 rounded-full">
              <AlertCircle className="h-12 w-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Bem-vindo ao NOC Monitor</h1>
          <p className="text-slate-500 mt-2">Preencha seu perfil para continuar</p>
        </div>

        {/* Form Card */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50 mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              Complete Suas Informações
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">Todos os campos são obrigatórios para solicitar acesso ao sistema</p>
          </CardHeader>
          <CardContent>
            <UserProfileForm user={user} onSuccess={handleProfileSuccess} isEditMode={false} />
          </CardContent>
        </Card>

        {/* Info Box */}
        <Card className="bg-blue-50 border-blue-200 mb-6">
          <CardContent className="pt-6">
            <div className="space-y-2 text-sm text-blue-900">
              <p className="font-semibold">O que acontece após preencher?</p>
              <ul className="space-y-1 text-xs text-blue-800">
                <li>✓ Um email será enviado ao administrador com seus dados</li>
                <li>✓ Sua solicitação entrará em análise</li>
                <li>✓ Você poderá enviar mensagens ao admin enquanto aguarda</li>
                <li>✓ Após aprovação, terá acesso completo ao sistema</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Logout Button */}
        <Button
          variant="outline"
          onClick={() => base44.auth.logout()}
          className="w-full gap-2 text-slate-500"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </div>
  );
}