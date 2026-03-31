import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Clock, LogOut, Shield, AlertCircle, CheckCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UserProfileForm from './UserProfileForm';
import ContactAdminForm from './ContactAdminForm';

export default function PendingApproval({ user: initialUser }) {
  const profileAlreadyFilled = !!(initialUser?.nome && initialUser?.telefone);
  const [activeTab, setActiveTab] = useState(profileAlreadyFilled ? 'contact' : 'profile');
  const [formSubmitted, setFormSubmitted] = useState(profileAlreadyFilled);
  const [user, setUser] = useState(initialUser);

  const handleProfileSuccess = async () => {
    // Recarrega dados atualizados do servidor
    try {
      const updated = await base44.auth.me();
      setUser(updated);
    } catch (e) {
      // fallback silencioso
    }
    setFormSubmitted(true);
    setActiveTab('contact');
  };

  return (
    <div className="bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-4">
      <div className="max-w-2xl w-full mx-auto py-8">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-5 bg-amber-100 rounded-full">
              <Clock className="h-12 w-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Bem-vindo ao NOC Monitor</h1>
          <p className="text-slate-500 mt-2">Seu cadastro está em análise para aprovação</p>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <Card className="border-2 bg-emerald-50 border-emerald-300">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-semibold text-sm text-slate-900">Perfil</p>
                  <p className="text-xs text-slate-500">Preenchido</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 bg-slate-50 border-slate-300">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-6 w-6 text-slate-400 shrink-0" />
                <div>
                  <p className="font-semibold text-sm text-slate-900">Aprovação</p>
                  <p className="text-xs text-slate-500">Aguardando admin</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs - Profile & Contact */}
        <Tabs value={activeTab} onValueChange={(tab) => {
          if (tab === 'contact' && !formSubmitted) return; // Bloqueia acesso a Contact sem preencher
          setActiveTab(tab);
        }} className="mb-6">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="profile">Preencher Solicitação</TabsTrigger>
            <TabsTrigger value="contact" disabled={!formSubmitted}>Contato com Admin</TabsTrigger>
          </TabsList>

          {/* Profile Tab - Always shows form */}
          <TabsContent value="profile" className="space-y-4">
            {!formSubmitted ? (
              // Form Mode
              <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                    Complete suas Informações
                  </CardTitle>
                  <p className="text-xs text-slate-500 mt-1">Preencha todos os campos para solicitar acesso ao sistema</p>
                </CardHeader>
                <CardContent>
                  <UserProfileForm user={user} onSuccess={handleProfileSuccess} isEditMode={false} />
                </CardContent>
              </Card>
            ) : (
              // View Mode - After submission
              <div className="space-y-4">
                <Card className="bg-emerald-50 border-emerald-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-6 w-6 text-emerald-600 shrink-0" />
                      <div>
                        <p className="font-semibold text-emerald-900">Solicitação Enviada!</p>
                        <p className="text-xs text-emerald-700">Seu perfil foi preenchido com sucesso</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Suas Informações</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFormSubmitted(false)}
                    >
                      ✏️ Editar
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 text-sm">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500 font-medium">Primeiro Nome</p>
                          <p className="text-slate-900 font-medium">{user?.nome || '—'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 font-medium">Sobrenome</p>
                          <p className="text-slate-900 font-medium">{user?.sobrenome || '—'}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 font-medium">Email</p>
                        <p className="text-slate-900 font-medium">{user?.email || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 font-medium">Telefone</p>
                        <p className="text-slate-900 font-medium">
                          {user?.pais_telefone && user?.telefone 
                            ? `${user.pais_telefone} ${user.telefone}`
                            : '—'
                          }
                        </p>
                      </div>
                      {user?.motivo_acesso && (
                        <div>
                          <p className="text-xs text-slate-500 font-medium">Motivo do Acesso</p>
                          <p className="text-slate-900 text-sm">{user.motivo_acesso}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Contact Tab */}
          <TabsContent value="contact">
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Enviar Mensagem ao Admin
                </CardTitle>
                <p className="text-xs text-slate-500 mt-1">Comunique diretamente com o administrador sobre sua solicitação de acesso</p>
              </CardHeader>
              <CardContent>
                <ContactAdminForm user={user} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Info Box */}
        <Card className="bg-blue-50 border-blue-200 mb-6">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Shield className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-sm">
                <p className="font-semibold text-blue-900">O que acontece agora?</p>
                <ul className="space-y-1 text-blue-800 text-xs">
                  <li>✓ Seu perfil foi registado no sistema</li>
                  <li>✓ Um administrador será notificado para análise</li>
                  <li>✓ Você pode editar seus dados na aba "Meu Perfil"</li>
                  <li>✓ Use a aba "Contato com Admin" para enviar mensagens</li>
                  <li>✓ Após aprovação, terá acesso completo ao sistema</li>
                </ul>
              </div>
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